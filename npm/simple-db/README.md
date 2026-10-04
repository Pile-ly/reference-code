# `@pilely/simple-db`

React hooks for the `simple_db` service — the platform's managed per-app database. A query hook for every read, a mutation hook for every write; record writes are optimistic. Render them inside `@pilely/core`'s `<PilelyProvider>`.

## Hooks

| Hook | Wraps | Kind |
| --- | --- | --- |
| `useRecords<T>(table, { eq?, limit? })` | `records/list`, paged | infinite query; `data` is the flattened `T[]`, plus `hasNextPage` / `fetchNextPage` |
| `useRecord<T>(table, id)` | `records/get` | query |
| `useCreateRecord<T>(table, { optimistic? })` | `records/create` | mutation, the record's fields |
| `useUpdateRecord<T>(table, { optimistic? })` | `records/update` | mutation, `{ id, patch }` |
| `useDeleteRecord(table, { optimistic? })` | `records/delete` | mutation, `id` |
| `useTables()` | `tables/list` | query; owner-only |
| `useCreateTable()` | `tables/create` | mutation, `{ table, columns, read_group, write_group, anon_read? }`; owner-only |
| `useAddColumn()` | `columns/add` | mutation, `{ table, column: { name, type, default? } }`; owner-only |
| `useSetTableAccess()` | `access/set` | mutation, `{ table, access: { read_group, write_group, anon_read? } }`; owner-only |
| `useDbApps()` | `apps/list` | query; owner-only |
| `useCreateDbApp()` | `apps/create` | mutation, no variables; owner-only |
| `useDeleteDbApp()` | `apps/delete` | mutation, optional `{ pile_row_exists }`; owner-only |

`T` is the record type and extends `DbRecord`. An `undefined` id disables `useRecord`, so a dependent read needs no conditional hook call. Rows come back flat (`post.title`); writes take the columns as a plain object.

Table and app hooks are owner-only on the server: they are for the app's own admin screens. Creating tables is a setup step, never something a visitor's page load does.

## What each write refreshes

| Write | Invalidates |
| --- | --- |
| record create / update / delete on table `T` | every `useRecords(T, …)`; for update / delete also `useRecord(T, id)` |
| table create / add column | `useTables()` |
| set access on table `T` | `useTables()` and every record query of `T` |
| app create | `useDbApps()` |
| app delete | everything under `["pilely", "simple-db"]` |

## Example

```tsx
import { useCreateRecord, useRecords } from "@pilely/simple-db";
import type { DbRecord } from "@pilely/simple-db";

interface Post extends DbRecord {
  title: string;
  body: string;
}

export function Posts() {
  const { data: posts, isLoading, hasNextPage, fetchNextPage } = useRecords<Post>("posts");
  const createPost = useCreateRecord<Post>("posts");

  return (
    <section>
      <button onClick={() => createPost.mutate({ title: "Hello", body: "First post" })}>New post</button>
      {createPost.error && <p role="alert">Your post was not saved: {createPost.error.message}</p>}
      {isLoading ? <p>Loading…</p> : posts?.map((post) => <article key={post.id}>{post.title}</article>)}
      {hasNextPage && <button onClick={() => void fetchNextPage()}>More</button>}
    </section>
  );
}
```

A comment list for one post filters with `eq`:

```ts
const { data: comments } = useRecords<Comment>("comments", { eq: { post_id: postId } });
```

## Optimistic record writes

`useCreateRecord`, `useUpdateRecord` and `useDeleteRecord` change the cache before the request goes out and undo that change only if the server refuses the write. Every other hook in every `@pilely` package waits for the server.

| Write | What shows at once |
| --- | --- |
| create on `T` | a row with a temporary id, the submitted fields, `_created_at_ms` = now and the signed-in user as submitter, at the top of the first page of every cached `useRecords(T, …)` whose `eq` filter it matches |
| update `id` on `T` | the patch, wherever the record is cached; a filtered list it no longer matches drops it, a list it now matches gains it only when the refresh lands |
| delete `id` on `T` | the record leaves every `useRecords(T, …)` and `useRecord(T, id)` clears |

- **Opt out** with `{ optimistic: false }` — `useCreateRecord<Post>("posts", { optimistic: false })` — for a flow that must show only what the server confirmed.
- **The server always has the last word.** Every write ends by refreshing the queries in the table above, once no other record write on the same table is still in flight. The server's id, timestamps, submitter fields and column defaults replace the optimistic row then.
- **Render a refused write's error.** A refused write is a bare 404 (signed out, not in `write_group`, not the owner). The row rolls back and the hook's `error` holds the `PilelyError` until the next attempt or `reset()` — show it, as the example does, so the user knows why their post disappeared.
- **Show edit and delete controls to the owner only.** `records/update` and `records/delete` are owner-only, so a visitor's optimistic edit always rolls back.
- **Temporary ids start with `pilely-temp-`** (exported as `TEMP_ID_PREFIX`). Use it to dim a pending row. When the real record arrives, a component keyed by `id` re-mounts once: keep no input state inside a just-created row. Updating or deleting a pending row is safe — the hook waits for the create and sends the real id, or sends nothing if the create failed. `useRecord` with a temporary id stays disabled.
- Overlapping writes never undo each other: a refused write rolls back only its own row, its own fields, or its own removal.

## Query keys

| Key | Query |
| --- | --- |
| `["pilely", "simple-db", "records", table, "list", { eq, limit }]` | `useRecords` |
| `["pilely", "simple-db", "records", table, "get", id]` | `useRecord` |
| `["pilely", "simple-db", "tables"]` | `useTables` |
| `["pilely", "simple-db", "apps"]` | `useDbApps` |

## Tearing a database down

`useDeleteDbApp()` drops every table, every record and the registry rows behind them. There is no undo: a create afterwards gives an empty database, not the old one. Its one option, `pile_row_exists`, defaults to `true` and is only `false` in the account-deletion sweep.

## Mock mode

Importing this package in a build made with `VITE_PILELY_MOCK=1` registers an in-browser fake of `simple_db` behind `@pilely/core`'s mock runtime — nothing else to call. The hooks then answer from memory with the JSON the real service returns.

The fake models apps, tables and records, persisted to `localStorage` across reloads. An app or table that does not exist is created on first use, so mock mode needs no create step. Rows carry the same `_submitter_*` and timestamp columns, lists page with the service's cursors, a missing row answers the bare 404, and a taken name answers `db_already_exists`, `table_exists` or `column_exists` (409). It does not model access groups, `anon_read`, the 20-apps cap, quotas or rate limits.

Writes need a signed-in user: a signed-out write answers the uniform bare 404, so an optimistic write made signed out appears, rolls back and leaves `PilelyError(404)` in `error`. The fake answers at once, so a pending state is never visible in mock mode. See [`@pilely/core`](../core#mock-mode) for the switch, `seedMock()` and `resetMock()`.

## Error codes

Refusals arrive as `PilelyError` in the hook's `error`, with a `code` drawn from `SimpleDbErrorCode`. Match on the code, never on the status:

| Code | Status | Means |
| --- | --- | --- |
| `null` | 404 | the bare uniform 404 — denied and nonexistent are indistinguishable by design |
| `not_found` / `app_not_found` | 404 | the same hide, with an envelope |
| `db_already_exists` | 409 | the app already has a database |
| `table_exists` / `column_exists` | 409 | the name is taken |
| `limit_reached` | 409 | the 20-apps-per-owner cap |
| `bad_request` | 400 | malformed body |
| `unauthenticated` | 401 | no usable token |
| `bad_forwarded_identity` | 401 | the forwarded-identity header did not verify |
| `rate_limited` | 429 | per-user window |
| `internal` | 500 | reads retry it automatically |

## Install

```sh
npm install @pilely/simple-db @pilely/core @tanstack/react-query
```

`@pilely/core`, `react` (`^18.3 || ^19`) and `@tanstack/react-query` (`^5`) are peer dependencies. Always install with the scope — unscoped names like `pilely-db` are not owned by this project. This is a pre-1.0 package and moves with the platform.
