# `@pilely/simple-db`

A typed client for the `simple_db` service — the platform's managed
per-app database. Wraps all 11 of its POST routes: app provisioning, table
admin, and record CRUD.

## Install

```sh
npm install @pilely/simple-db @pilely/core
```

Always install with the scope — `pilely-db` and similar unscoped names are
not owned by this project and are squattable. `@pilely/core` is a peer
dependency; an app has exactly one facade, never two.

## Writes nest, reads are flat

Send a record's columns nested under `fields`:

```ts
const post = await createRecord<PostRecord>("posts", { title: "Hello" });
```

but the row that comes back — from `createRecord`, `getRecord`,
`updateRecord`, and every row in a `listRecords`/`listAllRecords` page — is
**flat**: `post.title`, not `post.fields.title`. The request and response
shapes are genuinely different, and this package types them that way rather
than pretending they are the same object.

## Status

This is a pre-1.0 package and moves with the platform. Nothing here is
published to the registry yet. Zero runtime dependencies.
