# `@pilely` npm packages

The `@pilely` scope's typed client packages for building pilely.app neoApps.
Install a package instead of reading a route table and hand-writing a client.

| Package | Wraps |
| --- | --- |
| [`@pilely/core`](./core) | the `client.js` runtime — `window.pilely`, `serviceOrigin`, `appId`, `ready`, `PilelyError` and the one `call()` every service package goes through |
| [`@pilely/simple-db`](./simple-db) | the simple_db service (tables, records) |
| [`@pilely/simple-blob`](./simple-blob) | the simple_blob service (file upload/download) |
| [`@pilely/simple-group`](./simple-group) | the simple_group service (groups, members, permissions) |
| [`@pilely/simple-email`](./simple-email) | the simple_email service (send, templates, accounts) |
| [`@pilely/simple-limiter`](./simple-limiter) | the simple_limiter service (owner-defined rate-limit policies) |
| [`@pilely/create-pilely-app`](./create-pilely-app) | scaffolds a neoApp — Vite + React laid out to the SPA standard, with the chosen service packages; run with `npm create @pilely/pilely-app` |

Every service package depends on `@pilely/core` as a peer — one façade per app,
never two.

## What `@pilely/core` is, and is not

`core` is a **typed façade over the `client.js` runtime**, never a second
runtime. The bootstrap page a gated app receives before it opens loads only
`client.js`; that script runs at parse time, consumes the login callback and
attempts the anonymous mint before any app code — including an npm bundle —
gets a chance to run. `client.js` also ships unversioned from the apex, so a
fix reaches every deployed app on next load, which nothing installed through
npm can match. For all of that, `core` never reimplements the runtime: no
PKCE, no state nonce, no mint dance, no token storage, no `spa_ticket` logic,
no re-mint cooldown. It only wraps `window.pilely`.

## Install

```sh
npm install @pilely/core @pilely/simple-db
```

Always install with the scope — the unscoped near-miss names
(`pilely-core`, `pilely-db`, ...) are not owned by this project and are
squattable.

**The registry is behind this source.** `0.1.0` of `core`, `simple-db`, `simple-blob`,
`simple-group` and `simple-email` is published; `simple-limiter` has never been published; this tree
is at `0.2.1`. These are pre-1.0 packages that move with the platform, and `0.1.0`'s types are known
wrong in the nullability cases the `0.2.x` line fixes — do not treat what installs today as current.

## Error codes are part of the contract

Every service package exports a `Simple<X>ErrorCode` union naming every
`code` its service can put in a `{ok:false, code, reason}` refusal, and its
README lists them with their statuses. A new package does the same; a route
that gains a code updates the union in the same effort that adds it.

This is a rule rather than a preference because **status is not a
discriminator**. `simple_email` answers 429 for both `rate_limited` (retry
shortly) and `daily_cap_exceeded` (retry tomorrow); `simple_blob` answers
402 `storage_exceeded` beside 503 `quota_unavailable`, where only the second
is worth a retry. A consumer that cannot see the code set cannot write either
of those behaviours, and until the 2026-09 review none of the packages
exposed one.

Two asymmetries the unions preserve on purpose: `simple_limiter` says
`internal_error` where its four siblings say `internal`, and `simple_db` uses
`app_not_found` for the app subtree and plain `not_found` everywhere else.

## Workspace commands

Run from this directory:

```sh
npm install
npm run build       # builds core first, then the four service packages
npm run typecheck   # includes the test files — see below
npm run test
```

`typecheck` runs twice per package: once over `tsconfig.json` (the build's
view, which excludes `*.test.ts`) and once over `tsconfig.test.json`, which
includes them and emits nothing. The second pass exists because vitest does
not typecheck: without it a test stub annotated `PilelyClient` can quietly
stop satisfying the interface, which is exactly how `authOrigin` went missing
from all eight stubs.
