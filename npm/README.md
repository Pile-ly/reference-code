# `@pilely` npm packages

The `@pilely` scope's React packages for building pilely.app neoApps: one provider at the root, and a typed hook for every read and every write of a managed service. Install a package instead of reading a route table and hand-writing a client.

| Package | What it gives an app |
| --- | --- |
| [`@pilely/core`](./core) | `<PilelyProvider>`, `usePilelyAuth()`, `<SignedIn>` / `<SignedOut>`, `PilelyError`, mock mode, and `call()` for a route no hook covers |
| [`@pilely/simple-db`](./simple-db) | hooks for the simple_db service (records, tables, apps), with optimistic record writes |
| [`@pilely/simple-blob`](./simple-blob) | hooks for the simple_blob service (upload, list, download URL, access, and the app owner's listing of every file uploaded through their app) |
| [`@pilely/simple-group`](./simple-group) | hooks for the simple_group service (groups, members, permissions) |
| [`@pilely/simple-email`](./simple-email) | hooks for the simple_email service (send, outbox, templates, accounts) |
| [`@pilely/create-pilely-app`](./create-pilely-app) | scaffolds a neoApp — Vite + React laid out to the SPA standard, `<PilelyProvider>` at the root, with the chosen service packages; run with `npm create @pilely/pilely-app` |

## One provider, a hook for every route

The packages are React-only. An app renders `<PilelyProvider>` once at its root and calls hooks below it:

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

A package's public API is its hooks, its types and its error-code union. The per-route functions underneath are internal. `@pilely/core`'s `call()` stays public for a route no hook covers.

Each package README has its hook table, what each write refreshes, and an example: [`core`](./core), [`simple-db`](./simple-db), [`simple-blob`](./simple-blob), [`simple-group`](./simple-group), [`simple-email`](./simple-email), [`create-pilely-app`](./create-pilely-app).

## What `@pilely/core` is, and is not

`core` is a **React view of the `client.js` runtime**, never a second runtime. The bootstrap page a gated app receives before it opens loads only `client.js`; that script runs at parse time, consumes the login callback and attempts the anonymous mint before any app code — including an npm bundle — gets a chance to run. `client.js` also ships unversioned from the apex, so a fix reaches every deployed app on next load, which nothing installed through npm can match. So `core` never reimplements the runtime: no PKCE, no state nonce, no mint dance, no token storage, no `spa_ticket` logic, no re-mint cooldown. `<PilelyProvider>` reads `ready`, `user()`, `signIn()` and `signOut()` off `window.pilely` and nothing else, and every hook reaches the network through `call()` and `window.pilely.fetch`.

The one exception is the **mock runtime** behind [mock mode](#mock-mode), and it does not breach that rule: it exists only in a Vite build made with `VITE_PILELY_MOCK=1`, so a production build carries none of it, and it has none of the pieces above because it has no credentials at all — `token()` is always `null`, sign-in is a local flag, and nothing it does leaves the page.

## Mock mode

Build with `VITE_PILELY_MOCK=1` and every `@pilely` package runs entirely in the browser against in-memory fake services — no backend, no network, no registered app, no app id, no sign-in round trip. Leave it unset and the packages behave exactly as they do without it. An app written against the real packages is its own mock.

- **The variable, and nothing else.** Mock mode is on only when `import.meta.env.VITE_PILELY_MOCK === "1"` at build time; unset, empty, `"true"`, `"0"` and every other value are off. There is no app-side call, plugin, subpath or `window` flag — set the variable and import the packages the app already imports. Nothing a page does at runtime turns it on or off.
- **A fake backend behind the real client.** `call()`, envelope parsing, `PilelyError`, error codes, `collectPages()` and every hook run unchanged. `core` answers its `client()` seam with an in-memory mock runtime instead of `window.pilely` (and assigns that runtime to `window.pilely`, so `<PilelyProvider>` reads `user()` / `signIn()` / `signOut()` off it as usual); the runtime's `fetch` hands each request to the fake its service package registered on import. A request no fake covers throws `no mock for <service> <path>` — it never reaches the network, and `client.js` is ignored even when it is loaded.
- **No mock code in a production build.** Every package keeps `"sideEffects": false` and registers its fake only behind the flag check, so `vite build` without the variable tree-shakes the mock runtime and every fake away — absent, not dormant.
- **Vite only.** Vite exposes only `VITE_*` variables to browser code and replaces the value statically in `vite build`. Under any other bundler, or wherever `import.meta.env` is absent, mock mode reads as off; other bundlers are unsupported for it.

Fakes model shape, not policy: the same envelopes, error codes, bare 404s and cursors as the real services, and writes need a signed-in user (a signed-out write gets the uniform bare 404). They do not model access groups, `anon_read`, caps, quotas, storage walls or rate limits. The mock starts signed out and empty and persists to `localStorage`; `@pilely/core`'s optional `seedMock()` and `resetMock()` add sample content and clear it. The [`core` README](./core#mock-mode) has the details, and each service package's README says what its own fake models.

## Install

```sh
npm install @pilely/core @pilely/simple-db @tanstack/react-query
```

`react` (`^18.3 || ^19`) and `@tanstack/react-query` (`^5`) are peer dependencies of every package, so an app holds exactly one copy of each; every service package also takes `@pilely/core` as a peer. Always install with the scope — the unscoped near-miss names (`pilely-core`, `pilely-db`, ...) are not owned by this project and are squattable.

**The registry has `0.4.0`** of all six packages, tagged `latest`, so a plain `npm install` gets the provider and hooks. This source moves six packages ahead of the registry, and every one of those versions is unpublished until someone runs the publish:

- `@pilely/core` `0.4.2` drops the `simple-limiter` and `simple-env` service labels (`0.4.1`, published for the since-removed `@pilely/simple-env`, is skipped), and `PilelyError` gains `id` and `currentVersion`, kept from a refusal envelope that carries them (`simple_db`'s `409 key_exists` and `409 version_conflict`) instead of dropped; its three-argument constructor is unchanged.
- `@pilely/simple-db` `0.5.2` (`0.5.0` and `0.5.1` never reached the registry) is a breaking change: `useTables` and `useDbApps` take an optional `{ limit, cursor }` and return one page (`{ tables, nextCursor }` / `{ apps, nextCursor }`) instead of an array, and `limit_reached` has left `SimpleDbErrorCode` (the service has no table or database cap). It also adds `order` (`"newest"` / `"oldest"`) to `useRecords` and the records list helpers, keyed into the cache, and documents that a records page can be short or empty while its cursor continues. It adds conditional writes: `_version` and `_key` on `DbRecord`, `key` on `useCreateRecord` (create-if-absent), `ifVersion` / `if` / `inc` on `useUpdateRecord`'s variables, `{ id, ifVersion }` on `useDeleteRecord`, `consistent` on `useRecord`, and `key_exists`, `version_conflict` and `condition_failed` in `SimpleDbErrorCode`; its mock follows the same rules. It adds row-level access: `DbTable` and `DbTableAccess` carry `read_scope`, `audience_column`, `mutate_scope`, `mutate_group` and `deny_group`, `useCreateTable` and `useSetTableAccess` take them (an omitted one keeps its value on `access/set`), the `access/set` answer is no longer cut down to the three group fields, and `useRecords` / the list helpers type `eq` on `_submitter_user_id`; its mock stores and answers the settings but does not scope rows. It adds the new-row email: `DbTable` carries `new_row_email` (`"off"`, `"each"` or `"daily"`; `"off"` on every table that never set it), `useSetNewRowEmail` wraps `notify/set` (answering `DbTableNewRowEmail`, `{ table, new_row_email }`, and refreshing `useTables`), and `SimpleDbErrorCode` gains `email_not_ready`, `email_check_unavailable` and the owner-only `out_of_traffic_credits`; its mock stores and echoes the setting but has no email service, so it never answers `email_not_ready`. It also documents that `useDbApps` / `listApps` answer only the calling app's own database (the service no longer lists the owner's other apps' databases to an app), and its mock does the same. An app pinned to `^0.4.0` keeps `0.4.0` until it moves its range.
- `@pilely/simple-group` `0.5.0` adds `useHandleLookup` (`POST /users/lookup`, an exact handle to a user id) and `useSetMembersCanList`, lets `useCreateGroup` set `members_can_list`, adds `members_can_list` to `Group`, and adds `app_grant_unsupported` to `SimpleGroupErrorCode`: `permission/add` now refuses an `app` subject. `limit_reached` stays, for the grant cap only; the service has no group or member cap. An app pinned to `^0.4.0` keeps `0.4.0` until it moves its range.
- `@pilely/simple-blob` `0.4.2` adds `useAppBlobs` and `useAppBlobSearch` (`POST /apps/{app_id}/list` and `/search`: every blob bound to an app, for its owner) and `uploader_user_id` / `payer_user_id` on `BlobMeta`: a blob uploaded through an app is billed to the app's owner. It also carries `0.4.1`'s `rate_limited` code. Additive, so an app pinned to `^0.4.0` picks it up once it is published.
- `@pilely/simple-email` `0.4.2` adds account sends and retry-safe sends: `useSend` takes `to_account` (`"self"` or `"owner"`, a template sent to the caller's or the owner's own account email; `to` is then omitted) and an optional `idempotency_key`, and its result carries `replayed`. `Account` gains `account_senders` (`"send_group"` or `"app_users"`), settable through `useCreateEmailAccount` and `useSetEmailAccountAccess`'s new object forms; `SendRow` gains `to_account` and `idempotency_key`; and `SimpleEmailErrorCode` gains `idempotency_key_reused` and `idempotency_key_in_progress` (both 409). It also carries `0.4.1`'s `rate_limited` code. Additive, so an app pinned to `^0.4.0` picks it up once it is published.
- `@pilely/create-pilely-app` `0.4.2` generates the `^0.5.0` range for `@pilely/simple-group`, and an app that names only its own host: vite `base: "/"` and no `/@<handle>` canonical link.

Every service package's `^0.4.0` core peer is satisfied by either core version. These are pre-1.0 packages that move with the platform: a change here is not shipped until its version is bumped and it is republished. `0.1.0`'s types are known wrong in the nullability cases the `0.2.x` line fixed — never pin below `0.3.0`.

## Error codes are part of the contract

Every service package exports a `Simple<X>ErrorCode` union naming every `code` its service can put in a `{ok:false, code, reason}` refusal, and its README lists them with their statuses. A new package does the same; a route that gains a code updates the union in the same effort that adds it.

This is a rule rather than a preference because **status is not a discriminator**. `simple_email` answers 503 for both `out_of_traffic_credits` (the owner must top up) and `phone_verification_unavailable` (retry shortly); `simple_blob` answers 402 `storage_exceeded` beside 503 `quota_unavailable`, where only the second is worth a retry. A consumer that cannot see the code set cannot write either of those behaviours.

One asymmetry the unions preserve on purpose: `simple_db` uses `app_not_found` for the app subtree and plain `not_found` everywhere else.

## Workspace commands

Run from this directory:

```sh
npm install
npm run build       # builds core first, then the four service packages
npm run typecheck   # includes the test files — see below
npm run test        # hook tests run under jsdom with @testing-library/react
```

`typecheck` runs twice per package: once over `tsconfig.json` (the build's view, which excludes the test files) and once over `tsconfig.test.json`, which includes them and emits nothing. The second pass exists because vitest does not typecheck: without it a test stub annotated `PilelyClient` can quietly stop satisfying the interface.
