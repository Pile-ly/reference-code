# `@pilely/simple-db`

A typed client for the `simple_db` service — the platform's managed
per-app database. Wraps all 12 of its POST routes: app provisioning, table
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

## Tearing a database down

`deleteApp()` drops every table, every record and the registry rows behind
them. There is no undo and no soft-delete tier — a `createApp()` afterwards
gives you an empty database, not the old one back.

```ts
await deleteApp();
```

It answers the bare `app_id`, not a `DbApp`: the row it would have projected
is gone. The one option, `pile_row_exists`, defaults to `true` and is only
ever `false` in the account-deletion sweep, where the pile row has already
been removed — an ordinary owner never passes it.

## Error codes

Refusals arrive as `PilelyError` with a `code` drawn from `SimpleDbErrorCode`.
Match on the code, never on the status:

| Code | Status | Means |
| --- | --- | --- |
| `not_found` / `app_not_found` | 404 | the uniform hide — denied and nonexistent are indistinguishable by design |
| `db_already_exists` | 409 | `createApp()` on an app that already has one |
| `table_exists` / `column_exists` | 409 | the name is taken |
| `limit_reached` | 409 | the 20-apps-per-owner cap |
| `bad_request` | 400 | malformed body |
| `unauthenticated` | 401 | no usable token |
| `bad_forwarded_identity` | 401 | the forwarded-identity header did not verify |
| `rate_limited` | 429 | per-user window |
| `internal` | 500 | retry |
