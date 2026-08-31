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

**Nothing here is published to the registry yet.** These are pre-1.0 packages
that move with the platform; versions all start at `0.1.0`.

## Workspace commands

Run from this directory:

```sh
npm install
npm run build       # builds core first, then the four service packages
npm run typecheck
npm run test
```
