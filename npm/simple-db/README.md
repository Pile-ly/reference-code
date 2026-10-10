# `@pilely/simple-db`

React hooks for the `simple_db` service — the platform's managed per-app database. A query hook for every read, a mutation hook for every write; record writes are optimistic. Render them inside `@pilely/core`'s `<PilelyProvider>`.

## Hooks

| Hook | Wraps | Kind |
| --- | --- | --- |
| `useRecords<T>(table, { eq?, limit?, order? })` | `records/list`, paged | infinite query; `data` is the flattened `T[]`, plus `hasNextPage` / `fetchNextPage` |
| `useRecord<T>(table, id, { consistent? })` | `records/get` | query |
| `useCreateRecord<T>(table, { optimistic?, key? })` | `records/create` | mutation, the record's fields |
| `useUpdateRecord<T>(table, { optimistic? })` | `records/update` | mutation, `{ id, patch, ifVersion?, if?, inc? }` |
| `useDeleteRecord(table, { optimistic? })` | `records/delete` | mutation, `id` or `{ id, ifVersion? }` |
| `useTables({ limit?, cursor? })` | `tables/list`, paged | query; `data` is one page, `{ tables, nextCursor }`; owner-only |
| `useCreateTable()` | `tables/create` | mutation, `{ table, columns, read_group, write_group, anon_read?, read_scope?, audience_column?, mutate_scope?, mutate_group?, deny_group? }`; owner-only |
| `useAddColumn()` | `columns/add` | mutation, `{ table, column: { name, type, default? } }`; owner-only |
| `useSetTableAccess()` | `access/set` | mutation, `{ table, access: { read_group, write_group, anon_read?, read_scope?, audience_column?, mutate_scope?, mutate_group?, deny_group? } }`; owner-only |
| `useSetNewRowEmail()` | `notify/set` | mutation, `{ table, new_row_email: "off" \| "each" \| "daily" }`; `data` is `{ table, new_row_email }`; owner-only |
| `useDbApps({ limit?, cursor? })` | `apps/list` | query; `data` is `{ apps, nextCursor }`: this app's own database (or none), `nextCursor` always `null`; owner-only |
| `useCreateDbApp()` | `apps/create` | mutation, no variables; owner-only |
| `useDeleteDbApp()` | `apps/delete` | mutation, optional `{ pile_row_exists }`; owner-only |

`T` is the record type and extends `DbRecord`. An `undefined` id disables `useRecord`, so a dependent read needs no conditional hook call. Rows come back flat (`post.title`); writes take the columns as a plain object.

Table and app hooks are owner-only on the server: they are for the app's own admin screens. Creating tables is a setup step, never something a visitor's page load does. There is no limit on how many tables an app has or how many databases an owner has.

### Who can read and change rows

Every table object (`useTables`, `useCreateTable`, `useAddColumn`) and every `useSetTableAccess` answer carries the table's access: `read_group`, `write_group`, `anon_read` and five row-level settings. A table that never set the five reads their defaults, which behave exactly as tables did before they existed:

| Setting | Values | Default | What it does |
| --- | --- | --- | --- |
| `read_scope` | `"all"` \| `"own"` | `"all"` | `"own"`: a non-owner lists and gets only the rows they submitted plus the rows whose audience column holds their user id; any other row is the uniform 404. Never with `anon_read: true` |
| `audience_column` | a declared `text` column \| `null` | `null` | names the user a row is addressed to. Set only in `useCreateTable` and never changed |
| `mutate_scope` | `"owner"` \| `"own"` | `"owner"` | `"own"`: a non-owner may update and delete the rows they submitted, while `write_group` admits them and `deny_group` does not hold them |
| `mutate_group` | group id \| `null` | `null` | staff: members read every row (whatever `read_group` and `read_scope` say) and update and delete any row |
| `deny_group` | group id \| `null` | `null` | bans: members' creates, updates and deletes are the uniform 404; their reads are unchanged. The owner is never denied |

- **`null` means no group for `mutate_group` and `deny_group`** — the opposite of `read_group` / `write_group`, where `null` is every user. A group is an ACTIVE `simple_group` you own; an empty string is `400`.
- **`useSetTableAccess` keeps every row-level key it leaves out.** `read_group` and `write_group` are always sent and replaced, and `anon_read` omitted is `false`, but an omitted row-level key keeps the table's current value, so a call that leaves them out never reopens an `"own"` table or lifts a ban. `audience_column` is accepted only equal to the current value, so sending back a `useTables` table works.
- **The audience rule.** On a table with an audience column, a non-owner may set it only to `null` or their own user id; anything else is `400`. The owner and the app's backend server may address a row to any user, who can then read it on a `read_scope: "own"` table. Being named grants read only.
- **The owner and the app's backend server read and change every row**, whatever the settings.
- **Group membership changes land within 5 seconds.** Adding someone to `deny_group` or `mutate_group`, and removing them, takes effect within that delay.
- **A just-created row can take a moment to appear** (normally under a second) in `useRecords`, a non-owner's `read_scope: "own"` list and lists filtered on `_submitter_user_id` or the audience column included. `useRecord(table, id, { consistent: true })` sees it at once.
- **Filter by submitter** with `useRecords(table, { eq: { _submitter_user_id: userId } })`: any signed-in reader may, on any table they may read, and it narrows within the rows they may see. A signed-out caller, or a value that is not a user id, is `400`. No other reserved field is filterable.
- A cursor issued under a different `read_scope` or to a different caller may be `400 bad_request`; start the list again without one.

### Emailing the owner about new rows

Every table object (`useTables`, `useCreateTable`, `useAddColumn`) also carries `new_row_email`: whether the app's owner is emailed when people other than the owner create rows in the table. A table that never set it reads `"off"`, and `useCreateTable` cannot set it — every new table starts `"off"`. `useSetNewRowEmail` is the only way to change it; `useSetTableAccess` neither takes nor answers it.

| Value | What the owner gets |
| --- | --- |
| `"off"` | nothing (the default) |
| `"each"` | an email soon after a new row, at most one per table per 10 minutes; rows created inside those 10 minutes are counted together in the next one |
| `"daily"` | one digest per UTC day that had new rows, sent in the first hour of the next UTC day |

- **Only other people's rows count.** Rows the owner creates — from their own surfaces, their agent or the app's backend server — never do.
- **The email goes to the owner's account email**, from the app's `@simple_email` address, billed and counted against the app's daily cap like any send from that account; it shows in that account's sends. It says how many rows arrived, in which table, over what period, and links to the app. It never carries a row's content, a submitter or a record id.
- **`"each"` and `"daily"` need the app's `@simple_email` account to be able to send**: the app has one, it has a sending address (the app has a subdomain label), and your phone is verified. Otherwise `error` is `400 email_not_ready` and the table keeps its value; `503 email_check_unavailable` means the check could not run and nothing changed. `"off"` always succeeds. The check sends nothing and costs nothing on `@simple_email`.
- **Every successful call resets the count**, the same value included: rows not yet reported are dropped, and `"off"` stops anything pending.
- **A send that is refused or fails is dropped**, never retried; the table keeps its value and the rows are unaffected. Creating rows is never slowed or refused by it.

```tsx
const setNewRowEmail = useSetNewRowEmail();
setNewRowEmail.mutate({ table: "inbox", new_row_email: "each" });
// no email account yet: setNewRowEmail.error is PilelyError { status: 400, code: "email_not_ready" }
```

### Record fields

Every record carries server-minted fields beside its columns: `id`, `_submitter_handle`, `_submitter_user_id` (absent for a signed-out reader of an `anon_read` table), `_created_at_ms`, `_updated_at_ms`, and:

- `_version` — `1` on create, one more on every successful update (set, `inc` or both); a refused update leaves it unchanged. A record stored without a version reads `1`. Detect change with `_version`, never `_updated_at_ms` (two updates in one millisecond can share a stamp), and send it back as `ifVersion`.
- `_key` — the `key` a keyed create gave, verbatim, or `null`. It never changes, and every reader of the record sees it: never put private data (an email, a name, a secret) in a key on a table others read.

None of them can be written: naming one in a create's fields, a `patch`, `if` or `inc` is `400 bad_request`.

### Conditional writes, keys and counters

Each option is sent only when given; a call without them sends no option field.

- **`key` on create** — create-if-absent. `useCreateRecord("subscriptions", { key: buyerId })` sends a fixed key on every create; `{ key: (fields) => fields.event_id }` derives one per write (`undefined` sends none). A key is 1–200 characters from `A–Z a–z 0–9 _ - . : @ / +` and unique per table **per submitter**: the owner and the app's backend servers share one key space, each other signed-in user has their own. When the submitter already has a row with the key, nothing is created and `error` is `409 key_exists` with that row's id in `error.id`. Deleting the row frees the key.
- **`ifVersion` on update and delete** — the write applies only while the record's `_version` equals it; otherwise `409 version_conflict`, nothing changes, and `error.currentVersion` holds the record's version.
- **`if` on update** — `{ column: value | null }`, each column must read the value (the equality `useRecords`' `eq` uses; `null` matches a column that reads null), else `409 condition_failed`. At most 64 columns. `if: { holder: null }` with `patch: { holder: me }` claims a free slot exactly once.
- **`inc` on update** — `{ column: number }`, an atomic add on an `integer` (whole numbers) or `real` column, starting from the value a read returns (null starts from 0); concurrent increments never lose a count. `patch` may be `{}`. At most 64 columns, none also in `patch`; another column type, or a result outside the column's range, is `400 bad_request`.
- **`consistent` on `useRecord`** — `true` reads the record strongly consistently (every write that answered before the read started), for about twice the read capacity. It shares the record's cache entry.

A `409` is only ever answered to a caller allowed to make the write, on a record that exists: a refused caller or a missing record still gets the uniform 404. When `ifVersion` and an `if` both fail, the answer is `version_conflict`. `if`, `ifVersion` and `inc` reach the callers update and delete do: the owner, a non-owner on a record they submitted when the table's `mutate_scope` is `"own"`, and a `mutate_group` member. Aimed at any other record they are the uniform 404, never a `409`. A `key` is scoped to its submitter, as above.

```tsx
const update = useUpdateRecord<Slot>("slots");
update.mutate({ id: slot.id, patch: { holder: me }, if: { holder: null } });
// a lost race: update.error is PilelyError { status: 409, code: "condition_failed" }

const remove = useDeleteRecord("leases");
remove.mutate({ id: lease.id, ifVersion: lease._version });
```

### Paging records

`useRecords` loads one page at a time and `fetchNextPage` follows the service's cursor:

- `order` — `"newest"` (the default) reads `_created_at_ms` descending, then `id`; `"oldest"` is the exact mirror. Anything else is `400 bad_request`. Lists in different orders are separate queries and never share a cache entry.
- `limit` — 1..100 rows per page; the server defaults to 50.
- A cursor continues only the order that issued it: sending it with the other `order` is `400 bad_request`, like a malformed one. The hook keeps the two together for you.
- **A page can hold fewer than `limit` rows, even none, while more exist.** A filtered read (`eq`, or a non-owner's list on a `read_scope: "own"` table) on a big table stops when its per-call read budget runs out and hands back a cursor to continue. `hasNextPage` stays `true` until the cursor is `null`, so keep calling `fetchNextPage` (or show a "More" button) through a short or empty page; only a `null` cursor ends the list.

```tsx
const { data: claims } = useRecords<Claim>("claims", { eq: { slot_id: slotId }, order: "oldest" });
```

### Paging tables and apps

`useTables` returns one page of tables, oldest first, rather than everything. `useDbApps` takes the same params but only ever answers this app's own database: through an app the service never lists the owner's other apps' databases, so its page holds at most one row and `nextCursor` is `null`.

- `limit` — 1..100 rows per page; the server defaults to 50. Outside the range is `400 bad_request`.
- `cursor` — the previous page's `nextCursor`, verbatim. A malformed one is `400 bad_request`.
- `nextCursor` — a string when more rows exist past this page, otherwise `null`. Following it until it is `null` returns each table exactly once.

No params means the first page. A page with no rows is `{ tables: [], nextCursor: null }`, never an error.

```tsx
import { useState } from "react";
import { useTables } from "@pilely/simple-db";

export function TableList() {
  const [cursor, setCursor] = useState<string | undefined>();
  const { data } = useTables({ limit: 20, cursor });
  const next = data?.nextCursor;
  return (
    <section>
      {data?.tables.map((table) => <p key={table.name}>{table.name}</p>)}
      {next && <button onClick={() => setCursor(next)}>Next page</button>}
    </section>
  );
}
```

## What each write refreshes

| Write | Invalidates |
| --- | --- |
| record create / update / delete on table `T` | every `useRecords(T, …)`; for update / delete also `useRecord(T, id)` |
| table create / add column | every `useTables(…)` page |
| set access on table `T` | every `useTables(…)` page and every record query of `T` |
| set new-row email on table `T` | every `useTables(…)` page |
| app create | every `useDbApps(…)` page |
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
| create on `T` | a row with a temporary id, the submitted fields, `_created_at_ms` = now and the signed-in user as submitter, in every cached `useRecords(T, …)` whose `eq` filter it matches: at the top of the first page of a newest-first list, at the end of an oldest-first list that has loaded its last page (one with pages still to load gains it when the refresh lands) |
| update `id` on `T` | the patch, wherever the record is cached; a filtered list it no longer matches drops it, a list it now matches gains it only when the refresh lands. An `inc` column and `_version` are not changed at once: they show when the refresh lands |
| delete `id` on `T` | the record leaves every `useRecords(T, …)` and `useRecord(T, id)` clears |

- **Opt out** with `{ optimistic: false }` — `useCreateRecord<Post>("posts", { optimistic: false })` — for a flow that must show only what the server confirmed.
- **The server always has the last word.** Every write ends by refreshing the queries in the table above, once no other record write on the same table is still in flight. The server's id, timestamps, submitter fields and column defaults replace the optimistic row then.
- **Render a refused write's error.** A refused write is a bare 404 (signed out, not in `write_group`, in `deny_group`, or not allowed to change that record), a `400` (an audience value naming another user), or one of the three `409`s when a `key`, `ifVersion` or `if` did not hold. The row rolls back and the hook's `error` holds the `PilelyError` until the next attempt or `reset()` — show it, as the example does, so the user knows why their post disappeared.
- **Show edit and delete controls only to who may use them.** `records/update` and `records/delete` are the owner's, plus, per the table's settings, a non-owner's on the records they submitted (`mutate_scope: "own"`) and a `mutate_group` member's on any record. Anyone else's optimistic edit always rolls back.
- **Temporary ids start with `pilely-temp-`** (exported as `TEMP_ID_PREFIX`). Use it to dim a pending row. When the real record arrives, a component keyed by `id` re-mounts once: keep no input state inside a just-created row. Updating or deleting a pending row is safe — the hook waits for the create and sends the real id, or sends nothing if the create failed. `useRecord` with a temporary id stays disabled.
- Overlapping writes never undo each other: a refused write rolls back only its own row, its own fields, or its own removal.

## Query keys

| Key | Query |
| --- | --- |
| `["pilely", "simple-db", "records", table, "list", { eq, limit, order }]` | `useRecords` |
| `["pilely", "simple-db", "records", table, "get", id]` | `useRecord` |
| `["pilely", "simple-db", "tables", { limit, cursor }]` | `useTables` |
| `["pilely", "simple-db", "apps", { limit, cursor }]` | `useDbApps` |

## Tearing a database down

`useDeleteDbApp()` drops every table, every record and the registry rows behind them. There is no undo: a create afterwards gives an empty database, not the old one. Its one option, `pile_row_exists`, defaults to `true` and is only `false` in the account-deletion sweep.

## Mock mode

Importing this package in a build made with `VITE_PILELY_MOCK=1` registers an in-browser fake of `simple_db` behind `@pilely/core`'s mock runtime — nothing else to call. The hooks then answer from memory with the JSON the real service returns.

The fake models apps, tables and records, persisted to `localStorage` across reloads. An app or table that does not exist is created on first use, so mock mode needs no create step. Rows carry the same `_submitter_*`, timestamp, `_version` and `_key` fields, lists page with the service's cursors (`records/list` honours `order` and refuses a cursor sent with the other order; its pages are always full until the last), a missing row answers the bare 404, and a taken name answers `db_already_exists`, `table_exists` or `column_exists` (409).

Record writes follow the service's rules: `_version` starts at 1 and rises by one per update; a keyed create is unique per submitter (the signed-in mock user) and answers `409 key_exists` with the existing `id`; `ifVersion`, `if` and `inc` answer the same `400`s and `409`s (with `current_version`) as the service, in the same order; and an unknown body field on a record route (a misspelled `ifVersion`) is `400 bad_request`. An `inc` or `if` on a column the fake has not seen yet reads it as null, and an `inc` types it from the number. Every read is already consistent. Tables store and answer the five row-level settings with their defaults, refuse their shape `400`s (an unknown scope, `"own"` with `anon_read: true`, an audience column that is not a declared `text` column or that changes, an empty or malformed group id), and `access/set` keeps an omitted one; `eq` on `_submitter_user_id` filters, and is `400` signed out. Every table reads `new_row_email: "off"` until `notify/set` changes it; `notify/set` refuses the service's `400`s (a missing key, a non-string, a value other than `"off"`, `"each"` or `"daily"`) and stores and echoes the value. The fake has no email service: it never answers `email_not_ready` or `email_check_unavailable`, accepts `"each"` and `"daily"` without checking an email account, and never sends anything — test the not-ready path against the real service. Nothing reads the settings: the fake does not scope rows, apply the audience rule, look groups up or check user-id shapes. It does not model access groups, `anon_read`, quotas or rate limits.

Writes need a signed-in user: a signed-out write answers the uniform bare 404, so an optimistic write made signed out appears, rolls back and leaves `PilelyError(404)` in `error`. The fake answers at once, so a pending state is never visible in mock mode. See [`@pilely/core`](../core#mock-mode) for the switch, `seedMock()` and `resetMock()`.

## Error codes

Refusals arrive as `PilelyError` in the hook's `error`, with a `code` drawn from `SimpleDbErrorCode`. Match on the code, never on the status. `error.id` and `error.currentVersion` (from `@pilely/core` `0.4.2`) carry the extra field of `key_exists` and `version_conflict`, and are `undefined` otherwise:

| Code | Status | Means |
| --- | --- | --- |
| `null` | 404 | the bare uniform 404 — denied and nonexistent are indistinguishable by design |
| `not_found` / `app_not_found` | 404 | the same hide, with an envelope |
| `db_already_exists` | 409 | the app already has a database |
| `table_exists` / `column_exists` | 409 | the name is taken |
| `key_exists` | 409 | a keyed create whose submitter already has a row with that key; nothing was created and `error.id` is that row's id |
| `version_conflict` | 409 | an `ifVersion` that is not the record's `_version`; nothing changed and `error.currentVersion` is the record's version |
| `condition_failed` | 409 | an `if` that does not hold (and `ifVersion`, when sent, matched); nothing changed |
| `email_not_ready` | 400 | `useSetNewRowEmail` with `"each"` or `"daily"` while the app's `@simple_email` account cannot send: there is none, it has no sending address, or your phone is not verified; the reason names which, and the table keeps its value |
| `bad_request` | 400 | malformed body, a `new_row_email` that is missing or not `"off"`, `"each"` or `"daily"`, an unknown body field on a record route, an unknown `read_scope` / `mutate_scope`, `read_scope: "own"` with `anon_read: true`, an `audience_column` that is not a declared `text` column or differs from the current one on `access/set`, a `mutate_group` / `deny_group` that is empty or not an ACTIVE group you own, an audience value that is not `null` or a user id (a non-owner's: their own), `eq` on `_submitter_user_id` signed out or with a value that is not a user id, a records cursor issued under another `read_scope` or to another caller, a list `limit` outside 1..100, a malformed `cursor`, a `records/list` `order` other than `"newest"` or `"oldest"`, a records cursor sent with the other `order`, a malformed `key` or `ifVersion`, an update changing no column, an `inc` on a column that is not `integer` / `real`, also in `patch`, or leaving the column's range, more than 64 `if` or `inc` columns, or a reserved field written |
| `unauthenticated` | 401 | no usable token |
| `bad_forwarded_identity` | 401 | the forwarded-identity header did not verify |
| `rate_limited` | 429 | over a `@simple_limiter` policy the app's owner set on this database; root answers it with a `Retry-After` header |
| `internal` | 500 | reads retry it automatically |
| `email_check_unavailable` | 503 | `useSetNewRowEmail` could not check the app's email account; nothing changed — retry shortly |
| `out_of_traffic_credits` | 503 | your account has no traffic balance left; top up. Shown to the database owner only — everyone else gets the uniform 404 |

## Install

```sh
npm install @pilely/simple-db @pilely/core @tanstack/react-query
```

`@pilely/core`, `react` (`^18.3 || ^19`) and `@tanstack/react-query` (`^5`) are peer dependencies. Always install with the scope — unscoped names like `pilely-db` are not owned by this project. This is a pre-1.0 package and moves with the platform.
