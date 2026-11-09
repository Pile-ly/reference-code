# `@pilely` npm packages

The `@pilely` scope's React packages for building pilely.app neoApps: one provider at the root, and a typed hook for every read and every write of a managed service. Install a package instead of reading a route table and hand-writing a client.

| Package | What it gives an app |
| --- | --- |
| [`@pilely/core`](./core) | `<PilelyProvider>`, `usePilelyAuth()`, `<SignedIn>` / `<SignedOut>`, `PilelyError`, mock mode, and `call()` for a route no hook covers |
| [`@pilely/simple-db`](./simple-db) | hooks for the simple_db service (records listed in a table's declared sorts, filtered with `where` and counted; tables, apps, and files as a column type: a `File` passed as a field value is uploaded in the same call), with optimistic record writes |
| [`@pilely/simple-group`](./simple-group) | hooks for the simple_group service (groups, members, permissions) |
| [`@pilely/simple-email`](./simple-email) | the simple_email service: `sendTemplate()` / `useSendTemplate()`, the template send a page makes to the address the owner stored on a template; `send()`, the freestyle send for the app's backend only (`@pilely/simple-email/send`, no React); hooks for accounts and templates |
| [`@pilely/simple-limiter`](./simple-limiter) | the bot check in the browser: `getChallenge()` and `solveChallenge()`, whose answer an app sends as `{ challenge }` on a call its owner put a challenge policy on |
| [`@pilely/create-pilely-app`](./create-pilely-app) | scaffolds a neoApp — Vite + React laid out to the SPA standard, `<PilelyProvider>` at the root, with the chosen service packages; run with `npm create @pilely/pilely-app` |

## One provider, a hook for every route

The packages are React packages for a page. The one server-side function is `@pilely/simple-email`'s `send()`, the freestyle send only an app's backend may make: it is exported from the `@pilely/simple-email/send` subpath, imports neither `@pilely/core` nor React, and takes the backend token explicitly. An app renders `<PilelyProvider>` once at its root and calls hooks below it:

```tsx
// main.tsx
<PilelyProvider>
  <App />
</PilelyProvider>

// anywhere inside
const { user, signIn, signOut } = usePilelyAuth();
const { data: posts, isLoading } = useRecords<Post>("posts");
const createPost = useCreateRecord<Post>("posts");
await createPost.mutateAsync({ title, body }); // every useRecords("posts") on the page refreshes
```

- **One provider.** `<PilelyProvider>` is the app's single source of auth state and its single data cache. It takes an optional `queryClient` for an app that already owns one.
- **TanStack Query underneath.** Every hook is a typed wrapper over `useQuery`, `useInfiniteQuery` or `useMutation`, and answers TanStack's own result (`data`, `isLoading`, `error`, `mutateAsync`, `isPending`, ...).
- **Hooks wait for `ready`.** No query hook sends a request until `window.pilely.ready` settled, so no page can call a service before the runtime's boot and bounce a visitor to login.
- **Writes refresh reads.** Every mutation hook invalidates, on success, every query its write can change and nothing outside its service. App code never calls `refetch()`. Each package README lists what each of its writes refreshes.
- **Identity change clears the cache.** Sign-in and sign-out clear every query under the `["pilely"]` key root; queries still on screen refetch under the new identity.
- **simple-db record writes are optimistic.** `useCreateRecord`, `useUpdateRecord` and `useDeleteRecord` show the change before the server answers and roll back only that write, with its error, if the server refuses it. `{ optimistic: false }` turns it off. Every other write in every package waits for the server.
- **Errors are `PilelyError`.** A refusal reaches the hook's `error` with the package's `Simple<X>ErrorCode` union intact. A 4xx is never retried; 5xx and network errors get TanStack's default retry.
- **Query keys are `["pilely", <service>, ...]`**, documented per package, so an app can invalidate by hand when it must.

- **Bot checks ride `{ challenge }`.** Every hook (and `call()`) takes a `challenge` option: the answer `@pilely/simple-limiter`'s `solveChallenge()` returns, or a function answering one, asked once for each request. It goes out as the `X-Pilely-Challenge` header, which root checks on a call the app's owner put a challenge policy on (`https://simple-limiter.pilely.app/README.md`) and ignores elsewhere. One answer works for one call.

A package's public API is its hooks, its types and its error-code union. The per-route functions underneath are internal, except the few a package's README names as exports (`@pilely/simple-email`'s `sendTemplate()` and `send()`, `@pilely/simple-group`'s two group-id functions). `@pilely/core`'s `call()` stays public for a route no hook covers. `@pilely/simple-limiter` is the one package with no hooks: an app's page calls one route of its service, `POST /challenge`, and its two functions are its whole API.

Each package README has its hook table, what each write refreshes, and an example: [`core`](./core), [`simple-db`](./simple-db), [`simple-group`](./simple-group), [`simple-email`](./simple-email), [`simple-limiter`](./simple-limiter), [`create-pilely-app`](./create-pilely-app).

## What `@pilely/core` is, and is not

`core` is a **React view of the `client.js` runtime**, never a second runtime. The bootstrap page a gated app receives before it opens loads only `client.js`; that script runs at parse time, consumes the login callback and attempts the anonymous mint before any app code — including an npm bundle — gets a chance to run. `client.js` also ships unversioned from the apex, so a fix reaches every deployed app on next load, which nothing installed through npm can match. So `core` never reimplements the runtime: no PKCE, no state nonce, no mint dance, no token storage, no `spa_ticket` logic, no re-mint cooldown. `<PilelyProvider>` reads `ready`, `user()`, `signIn()` and `signOut()` off `window.pilely` and nothing else, and every hook reaches the network through `call()` and `window.pilely.fetch`.

The one exception is the **mock runtime** behind [mock mode](#mock-mode), and it does not breach that rule: it exists only in a Vite build made with `VITE_PILELY_MOCK=1`, so a production build carries none of it, and it has none of the pieces above because it has no credentials at all — `token()` is always `null`, sign-in is a local flag, and nothing it does leaves the page.

## Mock mode

Build with `VITE_PILELY_MOCK=1` and every `@pilely` package runs entirely in the browser against in-memory fake services — no backend, no network, no registered app, no app id, no sign-in round trip. Leave it unset and the packages behave exactly as they do without it. An app written against the real packages is its own mock.

- **The variable, and nothing else.** Mock mode is on only when `import.meta.env.VITE_PILELY_MOCK === "1"` at build time; unset, empty, `"true"`, `"0"` and every other value are off. There is no app-side call, plugin, subpath or `window` flag — set the variable and import the packages the app already imports. Nothing a page does at runtime turns it on or off.
- **A fake backend behind the real client.** `call()`, envelope parsing, `PilelyError`, error codes, `collectPages()` and every hook run unchanged. `core` answers its `client()` seam with an in-memory mock runtime instead of `window.pilely` (and assigns that runtime to `window.pilely`, so `<PilelyProvider>` reads `user()` / `signIn()` / `signOut()` off it as usual); the runtime's `fetch` hands each request to the fake its service package registered on import. A request no fake covers throws `no mock for <service> <path>` — it never reaches the network, and `client.js` is ignored even when it is loaded.
- **No mock code in a production build.** Every package keeps `"sideEffects": false` and registers its fake only behind the flag check, so `vite build` without the variable tree-shakes the mock runtime and every fake away — absent, not dormant.
- **Vite only.** Vite exposes only `VITE_*` variables to browser code and replaces the value statically in `vite build`. Under any other bundler, or wherever `import.meta.env` is absent, mock mode reads as off; other bundlers are unsupported for it.

Fakes model shape more than policy: the same envelopes, error codes, bare 404s and cursors as the real services. The simple-db fake admits callers by a table's policies — the owner (the mock user) bypasses them, the two platform-wide groups hold callers by type, and any other group holds nobody, since no fake keeps group membership for another — so a signed-out create or upload works where the policies name the anonymous group and every other refused write gets the uniform bare 404. The simple-email fake admits a template send the same way, by the template's `send_group`. The other fakes refuse a signed-out write with it. They do not model group membership across services, caps, quotas, storage walls, rate limits or challenge policies: every fake ignores a `challenge`, and the simple-limiter fake hands out challenges `solveChallenge()` solves like real ones. The mock starts signed out and empty and persists to `localStorage`; `@pilely/core`'s optional `seedMock()` and `resetMock()` add sample content and clear it. The [`core` README](./core#mock-mode) has the details, and each service package's README says what its own fake models.

## Install

```sh
npm install @pilely/core @pilely/simple-db @tanstack/react-query
```

`react` (`^18.3 || ^19`) and `@tanstack/react-query` (`^5`) are peer dependencies of every package but `@pilely/simple-limiter`, so an app holds exactly one copy of each; every service package, `simple-limiter` included, also takes `@pilely/core` as a peer. Always install with the scope — the unscoped near-miss names (`pilely-core`, `pilely-db`, ...) are not owned by this project and are squattable.

## Versions

Every package is published, and each library's source here is its registry `latest`:

| Package | Version | Range an app depends on |
| --- | --- | --- |
| `@pilely/core` | `0.4.4` (`0.4.4` adds the `challenge` call option and the `simple-limiter` service) | `^0.4.4` |
| `@pilely/simple-db` | `0.8.1` (`0.8.1` adds `{ challenge }` to every hook and the `challenge_required` / `challenge_failed` codes; `0.8.0` drops the two group-id constants — get the ids from `@pilely/simple-group`'s `anonymousGroupId()` / `authenticatedGroupId()`; `0.7.0` replaced the access settings with per-API `policies` and added signed-out creates and uploads) | `^0.8.1` (policies need `0.7.0` or later — `0.6.x` sends the removed settings, which the service refuses) |
| `@pilely/simple-group` | `0.7.1` (`0.7.1` adds `{ challenge }` to every function and hook and the two challenge codes; `0.7.0` replaces the two group-id constants with `anonymousGroupId()` / `authenticatedGroupId()`; `0.6.0` added the two platform-wide groups and the `global_group` code) | `^0.7.1` |
| `@pilely/simple-email` | `0.5.0` (`0.5.0` replaces `useSend()` with the template send — `sendTemplate()` / `useSendTemplate()` — and the backend-only `send()`, removes `useSends()`, `useSetEmailAccountAccess()` and the account's `send_group` / `account_senders`, and adds `recipient`, `send_group` and `deny_group` to templates; `0.4.5` added `{ challenge }` to every hook and the two challenge codes; `0.4.4` dropped two error codes and an account-info field the service no longer answers) | `^0.5.0` — every `0.4.x` sends and lists through `POST /send` and `POST /sends/list`, which the service no longer has |
| `@pilely/simple-limiter` | `0.5.0` (the name's `0.2.1`–`0.4.0`, React hooks over the rate-limit policy routes, were unpublished, and a version once used can never be published again, so the package returns at `0.5.0` with a new API: `getChallenge()` and `solveChallenge()`) | `^0.5.0` |
| `@pilely/create-pilely-app` | `0.4.3` in this source (offers `simple-limiter` and writes the ranges above; the registry's `create-pilely-app` writes the older ranges until it is republished) | run with `node <reference-code>/npm/create-pilely-app/index.js`, or `npm create @pilely/pilely-app` |

`create-pilely-app` writes these ranges. A caret on `0.x` never crosses a minor, so an app on an older minor stays on the older line until it moves its range. Check what a range resolves to with `npm view @pilely/<package>@'<range>' version`. Each package README documents what its current version does.

These are pre-1.0 packages that move with the platform: a change here ships only when its version is bumped and republished. Publish `core` first, then the service packages (`simple-limiter` among them: it peers on `@pilely/core` `^0.4.4`), then `create-pilely-app`, and update the table above. Never pin below `0.3.0`: `0.1.0`'s types are wrong in nullability cases.

## Error codes are part of the contract

Every service package exports a `Simple<X>ErrorCode` union naming every `code` its service can put in a `{ok:false, code, reason}` refusal, and its README lists them with their statuses. A new package does the same; a route that gains a code updates the union in the same effort that adds it.

This is a rule rather than a preference because **status is not a discriminator**. `simple_email` answers 429 for both `daily_cap_exceeded` (retry tomorrow) and `rate_limited` (retry after `Retry-After`); `simple_db` answers 402 `storage_exceeded` beside 503 `quota_unavailable`, where only the second is worth a retry. A consumer that cannot see the code set cannot write either of those behaviours.

One asymmetry the unions preserve on purpose: `simple_db` uses `app_not_found` for the app subtree and plain `not_found` everywhere else.

Two codes are root's, not a service's, and every service package's union carries both: `challenge_required` and `challenge_failed` (both `403`). Root answers them before any service, on a call that matches a challenge policy the app's owner set: no `challenge` sent, or one that was malformed, wrong, expired, started through another app, or already used. The fix is the same for both — get and solve a new challenge (`@pilely/simple-limiter`) and send the call again. `@pilely/simple-limiter`'s own union, `SimpleLimiterErrorCode`, covers `getChallenge()`'s refusals (root's `401 login_required` for a page with no token among them) and the `challenge_unsolvable` it mints itself.

## Workspace commands

Run from this directory:

```sh
npm install
npm run build       # builds core first, then the four service packages
npm run typecheck   # includes the test files — see below
npm run test        # hook tests run under jsdom with @testing-library/react
```

`typecheck` runs twice per package: once over `tsconfig.json` (the build's view, which excludes the test files) and once over `tsconfig.test.json`, which includes them and emits nothing. The second pass exists because vitest does not typecheck: without it a test stub annotated `PilelyClient` can quietly stop satisfying the interface.
