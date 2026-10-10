# `@pilely/core`

The React provider and auth hooks for a pilely.app neoApp. Render `<PilelyProvider>` once at the root; every `@pilely/simple-*` hook below it waits for the runtime's boot, caches in one TanStack Query client, and refreshes what each write changes.

## Hooks and components

| Export | What it is |
| --- | --- |
| `<PilelyProvider queryClient?>` | The one root provider. Owns auth state and a TanStack `QueryClient`; pass `queryClient` to use one the app already has, otherwise it creates its own. |
| `usePilelyAuth()` | `{ ready, user, signIn, signOut }`. `ready` is `false` until `window.pilely.ready` settled; `user` is `PilelyUser \| null`. |
| `<SignedIn>` | Renders its children once `ready`, only when signed in. Renders nothing before `ready`. |
| `<SignedOut>` | Renders its children once `ready`, only when signed out. Renders nothing before `ready`. |
| `call()` | The transport every service hook goes through, and the escape hatch for a route no hook covers. |
| `PilelyError` | The one error type every `@pilely` hook reports. |

```tsx
// main.tsx
import { PilelyProvider } from "@pilely/core";

createRoot(document.getElementById("root")!).render(
  <PilelyProvider>
    <App />
  </PilelyProvider>,
);
```

```tsx
// Header.tsx
import { SignedIn, SignedOut, usePilelyAuth } from "@pilely/core";

export function Header() {
  const { user, signIn, signOut } = usePilelyAuth();
  return (
    <header>
      <SignedIn>
        <span>@{user?.handle}</span>
        <button onClick={signOut}>Sign out</button>
      </SignedIn>
      <SignedOut>
        <button onClick={() => void signIn()}>Login with Pilely</button>
      </SignedOut>
    </header>
  );
}
```

## What the provider does

- **No call before `ready`.** Every query hook stays disabled until `window.pilely.ready` settled. Calling a service before then races the boot-time anonymous mint and can bounce a signed-out visitor to the login page; with the provider no app code can do it.
- **Signed in means `user !== null`.** Never gate UI on a status code: a denied write comes back as a uniform 404, not a 401.
- **`signIn()`** starts the sign-in dance. The real runtime navigates away; mock mode signs in in place, resolves, and the provider reads `user()` again.
- **Identity change clears the cache.** `signOut()`, and a `signIn()` that changes the user in place, update `user` and clear every query under the `["pilely"]` key root. Queries still on screen refetch under the new identity; writes still in flight never write into the cleared cache.
- **`client.js` absent** (a blocked script, offline dev without mock mode): `ready` becomes `true`, `user` stays `null`, the app renders signed out, and data hooks report `pilely client not loaded …` as their `error` instead of throwing during render.
- **Outside the provider** every hook and component throws `<name> must be used inside <PilelyProvider>`.

The provider reads `ready`, `user()`, `signIn()` and `signOut()` off `window.pilely` and nothing else; see [the boundary](#the-boundary-with-clientjs).

## Query keys and retries

Every `@pilely` query key starts `["pilely", <service>, ...]`; each service README lists its layout. To refresh by hand, invalidate a prefix:

```ts
import { useQueryClient } from "@tanstack/react-query";

const queryClient = useQueryClient();
await queryClient.invalidateQueries({ queryKey: ["pilely", "simple-db", "records", "posts"] });
```

Every hook sets its own retry rule, so it holds under an app-supplied `QueryClient` too: a `PilelyError` with a 4xx status is never retried (a 404 is a uniform denial, not a blip), 5xx and network errors get TanStack's default three retries, and nothing is retried when no runtime is loaded.

## A route no hook covers

`call()` sends one request through `window.pilely.fetch` to a managed service and answers its JSON, throwing `PilelyError` on a refusal. It waits for `ready` itself. Wrap it in TanStack's own hooks and keep the key under `["pilely"]` so an identity change clears it:

```ts
import { call } from "@pilely/core";
import { useQuery } from "@tanstack/react-query";

const stats = useQuery({
  queryKey: ["pilely", "simple-db", "custom-stats"],
  queryFn: () => call<{ count: number }>({ service: "simple-db", path: "/apps/my-app/stats" }),
});
```

Never hand-roll a `fetch` next to it: that is how a token reaches the wrong origin.

## Errors

`PilelyError` carries `status`, `code` (a service's `Simple<X>ErrorCode`, or `null` for the bare uniform 404) and `reason`, plus two fields a refusal sends only where its contract names them: `id` (the existing row a `simple_db` `409 key_exists` names) and `currentVersion` (the row's `_version` a `409 version_conflict` reports, `current_version` on the wire). Both are `undefined` on every other error. Every service refusal reaches a hook's `error` as one. Denied and does-not-exist are byte-identical by design: never branch on them separately.

## The boundary with `client.js`

`core` is a React view of the `client.js` runtime, never a second runtime: no PKCE, no state nonce, no mint dance, no token storage, no `spa_ticket` logic, no re-mint cooldown. `client.js` runs at parse time on the bootstrap page, before any app bundle loads, consumes the sign-in callback and attempts the anonymous mint; it ships unversioned from the apex so a fix reaches every app on its next load. The provider only reads what that runtime already exposes.

The **mock runtime** behind [mock mode](#mock-mode) does not breach that rule: it exists only in a Vite build made with `VITE_PILELY_MOCK=1`, and it has none of those pieces because it has no credentials at all.

## Mock mode

Build with `VITE_PILELY_MOCK=1` and every `@pilely` package runs entirely in the browser against in-memory fake services: no backend, no network, no registered app, no app id, no sign-in round trip. Leave it unset and nothing changes; a production build contains no mock code at all.

- **The switch.** On only when `import.meta.env.VITE_PILELY_MOCK === "1"` at build time. Unset, empty, `"true"`, `"0"` — anything else — is off. There is no app-side call, plugin, subpath or `window` flag.
- **Vite only.** Under any other bundler, or wherever `import.meta.env` is absent, mock mode reads as off.
- **A fake backend behind the real client.** `call()`, envelope parsing, `PilelyError`, error codes and every hook run unchanged; only the transport underneath is swapped. Each `@pilely/simple-*` package registers a fake of its service when imported in mock mode.
- **Fakes model shape, not policy.** Same JSON, error codes, bare 404s and cursors as the real services. Writes need a signed-in user (a signed-out write gets the uniform bare 404); no access groups, `anon_read`, caps, quotas, storage walls or rate limits.
- **Nothing leaves the page.** A request no fake covers throws `no mock for <service> <path>`; `client.js` is ignored even when loaded.
- **Identity.** The mock runtime is assigned to `window.pilely`, so `<PilelyProvider>` reads it exactly as it reads the real one. It starts signed out; `signIn()` and `signOut()` flip a fixed mock user in place without navigating. `ready` resolves at once.
- **State.** Fakes persist across reloads in `localStorage` under one namespaced key, identity included. simple-blob's bytes are memory-only.
- **`seedMock(seed)`** — optional sample content: `{ signedIn, tables, groups }`. It applies once per origin. Call it after importing the packages it seeds.
- **`resetMock()`** — clears every fake and the identity.
- Both are no-ops when mock mode is off. `isMockMode()` and `registerMockService()` are what the service packages build their fakes on.

## For the service packages

`@pilely/simple-*` build their hooks on `useServiceQuery`, `useServiceInfiniteQuery`, `useServiceMutation`, `useServiceContext`, `serviceQueryKey` and `serviceRetry`, and on the runtime accessors `ready()`, `appId()`, `serviceOrigin()`, `collectPages()` and `assertPilelyRuntime()`. Apps use the hooks above and the service packages' hooks instead.

`assertPilelyRuntime()` is a development-only check: it confirms `window.pilely` is present and, when a `<meta name="pilely-app">` tag exists, that it sits above the `client.js` script tag.

## Install

```sh
npm install @pilely/core @tanstack/react-query
```

`react` (`^18.3 || ^19`) and `@tanstack/react-query` (`^5`) are peer dependencies: an app holds exactly one copy of each. Always install with the scope — unscoped names like `pilely-core` are not owned by this project. This is a pre-1.0 package and moves with the platform.

## Known gap

The meta-tag ordering `assertPilelyRuntime()` enforces is not written into the platform's SPA build standard; this assertion is its only enforcement.
