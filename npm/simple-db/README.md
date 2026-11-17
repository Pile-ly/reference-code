# `@pilely/simple-db`

React hooks for the `simple_db` service — the platform's managed per-app database, files included as a column type. A query hook for every read, a mutation hook for every write; record writes are optimistic, and a `File` passed as a file field's value is uploaded in the same call. Render them inside `@pilely/core`'s `<PilelyProvider>`.

## Hooks

| Hook | Wraps | Kind |
| --- | --- | --- |
| `useRecords<T>(table, { sort?, order?, where?, eq?, limit?, fileUrls? })` | `records/list`, paged | infinite query; `data` is the flattened `T[]`, plus `hasNextPage` / `fetchNextPage` |
| `useRecordCount(table, { sort?, order?, where?, eq? })` | `records/list` with `count: true`, every part | query; `data` is the number of records the same `useRecords` list holds |
| `useRecord<T>(table, id, { consistent?, fileUrls? })` | `records/get` | query |
| `useCreateRecord<T>(table, { optimistic?, key? })` | `files/{column}/upload/start` and the storage `PUT` for each `File` field, then `records/create` | mutation, the record's fields |
| `useUpdateRecord<T>(table, { optimistic? })` | the same uploads, then `records/update` | mutation, `{ id, patch, ifVersion?, if?, inc? }` |
| `useFileUrl(table, id, column)` | `records/{id}/files/{column}/download` | query; `data` is `{ url, content_type, size_bytes }`, renewed before the link expires |
| `useDeleteRecord(table, { optimistic? })` | `records/delete` | mutation, `id` or `{ id, ifVersion? }` |
| `useTables({ limit?, cursor? })` | `tables/list`, paged | query; `data` is one page, `{ tables, nextCursor }`; owner-only |
| `useCreateTable()` | `tables/create` | mutation, `{ table, columns, policies?, deny_group?, sorts? }`; owner-only |
| `useSetSorts()` | `sorts/set` | mutation, `{ table, sorts }`: the table's whole new list of sorts; `data` is the table object; owner-only |
| `useAddColumn()` | `columns/add` | mutation, `{ table, column: { name, type, default? } }`; owner-only |
| `useSetTableAccess()` | `access/set` | mutation, `{ table, access: { policies, deny_group } }`, both replaced whole; `data` is `{ table, policies, deny_group, sorts }`; owner-only |
| `useSetNewRowEmail()` | `notify/set` | mutation, `{ table, new_row_email: "off" \| "each" \| "daily" }`; `data` is `{ table, new_row_email }`; owner-only |
| `useDbApps({ limit?, cursor? })` | `apps/list` | query; `data` is `{ apps, nextCursor }`: this app's own database (or none), `nextCursor` always `null`; owner-only |
| `useCreateDbApp()` | `apps/create` | mutation, no variables; owner-only |
| `useDeleteDbApp()` | `apps/delete` | mutation, optional `{ pile_row_exists }`; owner-only |

`T` is the record type and extends `DbRecord`. An `undefined` id disables `useRecord`, so a dependent read needs no conditional hook call. Rows come back flat (`post.title`); writes take the columns as a plain object.

Table and app hooks are owner-only on the server: they are for the app's own admin screens. Creating tables is a setup step, never something a visitor's page load does. There is no limit on how many tables an app has or how many databases an owner has.

### Bot checks: `{ challenge }`

The app's owner can put a **challenge policy** on any route here (`https://simple-limiter.pilely.app/README.md`), typically `records/create` on a table signed-out visitors write to. Root then refuses every matching call that carries no solved bot check with `403 challenge_required`, before the service sees it — the owner's own calls included. Every hook takes a `challenge` option for that, in its options object or as its last argument where it has none (`useCreateTable({ challenge })`, `useFileUrl(table, id, column, { challenge })`, `useTables(params, { challenge })`):

```tsx
import { getChallenge, solveChallenge } from "@pilely/simple-limiter";

const signUp = useCreateRecord<Signup>("signups", {
  challenge: async () => solveChallenge(await getChallenge()),
});
await signUp.mutateAsync({ email }); // gets, solves and sends a fresh answer
```

- **A string, or a function answering one.** A function (it may be async, and may answer `undefined`) is asked once for each request the hook sends, so every request can carry a fresh answer. `undefined` sends no header.
- **Every request the hook sends carries it** as the `X-Pilely-Challenge` header: each page of a list, each part of a count, and for a write with a `File` field each file's `upload/start` and then the write. Root uses an answer up only on a call a policy matches, and ignores it everywhere else.
- **One answer works for one call**, within 5 minutes of `getChallenge()`. A fixed string suits a hook that sends one request once; give a function to a hook that writes more than once or a read that refetches.
- **A refusal is a `PilelyError`** like any other: `403 challenge_required` (no answer) or `403 challenge_failed` (a wrong, expired, reused or other app's answer). A 4xx is never retried, so an answer is never re-sent; get and solve a new one to start over. An optimistic create shows its row while it solves, and rolls back on either refusal.

### Who can read and change rows

A table's access is its `policies` plus its `deny_group`, nothing else, and every table object (`useTables`, `useCreateTable`, `useAddColumn`, `useSetSorts`) and every `useSetTableAccess` answer carries both. Each of the seven record and file APIs has a list of policies; a policy is `{ group, rows }`:

- `group` — who may call: a `@simple_group` group you own that is active, or one of the two platform-wide groups below.
- `rows` — which rows the call reaches: a MongoDB query filter over the row (`DbFilter`). `{}` is every row.

A caller other than the owner is admitted to an API exactly when at least one of its policies matches: they are in the policy's group AND the row satisfies its filter. Every other call is the uniform 404. An API whose key is left out is owner-only, and a table created without `policies` is owner-only on every API.

| Policy key | Hook | What `rows` means |
| --- | --- | --- |
| `records/list` | `useRecords`, `useRecordCount` | only matching rows are returned and counted |
| `records/get` | `useRecord` | a row that does not match is the uniform 404 |
| `files/download` | `useFileUrl`, and `fileUrls` on `useRecord` / `useRecords` | the record holding the file must match; `fileUrls` adds a `url` only on the records that do |
| `records/create` | `useCreateRecord` | the new row, as a read will return it, must match |
| `records/update` | `useUpdateRecord` | the row before AND the row after the change must both match one policy |
| `records/delete` | `useDeleteRecord` | only a matching row may be deleted |
| `files/upload/start` | the upload behind a `File` field | only `group` decides — the row does not exist yet; `rows` must be sent and is not applied |

The two **platform-wide groups** are global platform values, the same on every app. This package prints neither id: get each from `@simple_group`, with `anonymousGroupId()` / `authenticatedGroupId()` from `@pilely/simple-group` or the routes they wrap. Any policy may name them although you do not own them; `deny_group` may not:

| Group | Get the id from | Who is in it |
| --- | --- | --- |
| anonymous | `anonymousGroupId()` — `POST /groups/anonymous` on `simple_group` | every signed-out visitor of the db's own app |
| authenticated | `authenticatedGroupId()` — `POST /groups/authenticated` on `simple_group` | every person signed in to pilely.app |

In mock mode this package's fake recognises the fixed test ids `@pilely/simple-group`'s fake answers, so the same code works there.

```ts
import { CALLER_ID } from "@pilely/simple-db";
import { anonymousGroupId, authenticatedGroupId } from "@pilely/simple-group";

const anonymous = await anonymousGroupId();
const authenticated = await authenticatedGroupId();

// Staff list every row; every other signed-in person lists only the rows
// they submitted; anyone, signed out included, may submit a row.
createTable.mutate({
  table: "requests",
  columns: [{ name: "body", type: "text" }, { name: "status", type: "text" }],
  policies: {
    "records/list": [
      { group: staffGroupId, rows: {} },
      { group: authenticated, rows: { _submitter_user_id: CALLER_ID } },
    ],
    "records/get": [{ group: authenticated, rows: { _submitter_user_id: CALLER_ID } }],
    "records/create": [
      { group: anonymous, rows: { status: "new" } },
      { group: authenticated, rows: { status: "new" } },
    ],
    "records/update": [{ group: staffGroupId, rows: {} }],
  },
  deny_group: bannedGroupId,
});
```

- **Filters.** `rows` is MongoDB query filter syntax over the columns and `_submitter_user_id` (text), `_created_at_ms` and `_updated_at_ms` (integer): every key of one object is ANDed; a field holds a bare value (`$eq`) or operators — `$eq $ne $gt $gte $lt $lte` (text, integer, real; `$eq` / `$ne` also boolean and json), `$in $nin` (1 to 100 values; text, integer, real, boolean), `$exists`, `$not` (an operator object) — and `$and`, `$or`, `$nor` hold non-empty arrays of filters. A `file` field compares only with `null` (or `$exists`); `null` is an operand of `$eq`, `$ne`, `$in` and `$nin` only.
- **`CALLER_ID`** (`"$$CALLER_ID"`) as a value of `$eq`, `$ne`, `$in` or `$nin` on a text field is the caller's id on each call: the person's user id, or the backend app's id. `{ _submitter_user_id: CALLER_ID }` is "only the rows I submitted", `{ to_user_id: CALLER_ID }` "only the rows addressed to me". A signed-out visitor has none: every comparison naming it is false for them, so an own-rows filter never matches the rows signed-out visitors create.
- **Where it differs from MongoDB.** A filter holds on the row as a read returns it: a column never written reads as its declared default, and an explicit `null` counts as no value. So `$ne`, `$nin`, `$not` and `$nor` match a row whose field reads `null`; `$gt`, `$gte`, `$lt`, `$lte` and `$in` (without `null`) never do; `{ c: null }`, `{ c: { $exists: false } }` and a `null` in `$in` match a row whose `c` reads `null`.
- **`400 bad_request`** at `useCreateTable` / `useSetTableAccess` for a key that is not one of the seven, an empty list, a policy that is not exactly `{ group, rows }` (`rows` is required even on `files/upload/start`), a group that is neither an active group you own nor a platform-wide group, a `deny_group` that is not an active group you own, and a filter naming an unknown field, an operator its type does not take, a wrongly typed value, anything outside the syntax (another `$` operator, a top-level `$not`), or rendering over DynamoDB's 4 KB / 300 operators on its own. A filter checks against the columns as they stand: add a column first, then name it in a policy.
- **`useSetTableAccess` replaces both whole** — `{ policies: {}, deny_group: null }` makes the table owner-only with no ban — and takes effect on the very next request, for records stored before it too. Sending back what `useTables` answered keeps a table as it is.
- **The removed settings.** `read_group`, `write_group`, `anon_read`, `read_scope`, `mutate_scope`, `mutate_group` and `audience_column` are gone: sending any of them is `400 bad_request` naming its replacement, before anything else. A table created with them answers every caller as before, through the policies the service turned them into, which `useTables` shows.
- **`deny_group`** — `null` (no group) or an active group you own. Its members get the uniform 404 on create, update, delete and upload, whatever the policies say; their reads follow the policies. The owner is never denied.
- **The owner bypasses every policy**, from their own surfaces (never from inside another app). **The app's backend server** is admitted only through a group it is an `app` member of: it is in neither platform-wide group, and its rows carry the app's id as `_submitter_user_id`.
- **Signed-out visitors** reach only the APIs whose policies name the anonymous group, and only the rows those filters allow: they list, get and download; create (stamped `_submitter_user_id` = `NIL_SUBMITTER_ID`, `"00000000-0000-0000-0000-000000000000"`, and `_submitter_handle` = `""`; a `key` is `400`); and upload a `File` into the row they create. They never update or delete, whatever the policies say, and never see `_submitter_user_id`. All signed-out visitors are one caller to the service: whoever holds a signed-out upload's id may attach it, and the hook keeps it inside the one call.
- **Group membership changes land within 5 seconds.** Adding someone to a policy's group or to `deny_group`, and removing them, takes effect within that delay; membership is managed in `@pilely/simple-group`, never here.
- **A just-created row can take a moment to appear** (normally under a second) in `useRecords`, lists a policy filter limits and lists filtered on `_submitter_user_id` included. `useRecord(table, id, { consistent: true })` sees it at once.
- **Filter by submitter** with `useRecords(table, { eq: { _submitter_user_id: userId } })` (or the same key in `where`): any signed-in reader may, and it narrows within the rows the policies let them list. A signed-out caller, or a value that is not a user id, is `400`. Besides it, `where` takes only `_created_at_ms` and `_updated_at_ms` of the reserved fields, and `eq` none.
- A list's whole condition — its `where`, its `eq` and the filters of the policies admitting the caller — must fit DynamoDB's 4 KB rendered and 300 operators (`400` over).
- Every cursor is bound to the caller it was issued to and the policies that admitted them (the whole table for the owner): a cursor sent by a different caller (a person, the app's backend server, or a signed-out visitor — all signed-out visitors are one caller), or after a `useSetTableAccess` or a membership change that changed which policies admit the caller, is `400 bad_request`; start the list again without one.

### Files

A file is a value in a record: a table declares a column of type `"file"` (`useCreateTable` or `useAddColumn`, no `default`), and each record holds at most one file in it. The table's policies decide everything — a `files/upload/start` policy admits the upload and the record write's own policy the attach, a `files/download` policy the download — and there is no file outside a record.

- **One call.** Pass a browser `File` or `Blob` as the field's value in `useCreateRecord` or `useUpdateRecord`. The hook runs `upload/start` for the column, `PUT`s the bytes straight to the storage host's presigned link (a plain `fetch` with the file's `Content-Type` and no credential: the bytes never pass through a pilely.app server), then sends the record write with `{ "upload": "<upload_id>" }` in the field, which attaches the file. A `Blob` with no type is sent as `application/octet-stream`.
- **`null` clears the field** and deletes its file; a new `File` on an update replaces the old file, which is deleted once the update commits. A refused write deletes nothing, and the upload stays usable for another try until an hour after its link expired.
- **The field reads `DbFile`**: `{ file_id, content_type, size_bytes }`, `size_bytes` being what storage received. Declare the column in your record type as `DbFile | null`; `RecordFields<T>` then takes `File | Blob | null` for it.
- **Links.** `fileUrls: true` on `useRecord` / `useRecords` adds `url`, a presigned `GET` valid 5 to 10 minutes from the fetch, to every non-null file field (each link is billed to the owner); a page that stays open longer reads again. `useFileUrl(table, id, column)` reads one file's link from the `download` route and renews it on its own before it can expire. Never store a link.
- **A new file is not optimistic; a clear is.** The cache never holds a `File`: an optimistic create shows the row without a `File` field, an optimistic update shows the other fields of its patch, and the server's `DbFile` lands with the refresh. A `null` is an ordinary optimistic value: the field shows `null` at once and is restored if the server refuses the write.
- **2 GB per file.** A bigger `File` is refused as `413 file_too_large` before anything is sent. `storage_exceeded` (402) refuses an upload or an attach the owner's storage cannot hold — to the owner only; every other caller gets the uniform 404 — and `quota_unavailable` (503) means the allowance could not be checked: retry shortly.
- A storage host that refuses the `PUT` (an expired link, a network policy) throws `upload_failed` with the storage host's status; a `PUT` that never reaches it (offline, a CORS refusal) throws `upload_failed` with status `0`. Either way no record is written.
- A `file` column is never an `eq` filter, an `if` condition or an `inc` target (`400`). A field accepts only a `File` / `Blob` (or, raw, `{ upload }`) and `null`: a `file_id` or a link is `400`.

```tsx
interface Comment extends DbRecord {
  body: string;
  image: DbFile | null;
}

const addComment = useCreateRecord<Comment>("comments");
addComment.mutate({ body, image: file }); // file: a File from an <input type="file">

const { data: comments } = useRecords<Comment>("comments", { fileUrls: true });
// <img src={comment.image?.url} />
```

### Emailing the owner about new rows

Every table object (`useTables`, `useCreateTable`, `useAddColumn`) also carries `new_row_email`: whether the app's owner is emailed when people other than the owner create rows in the table. A table that never set it reads `"off"`, and `useCreateTable` cannot set it — every new table starts `"off"`. `useSetNewRowEmail` is the only way to change it; `useSetTableAccess` neither takes nor answers it.

| Value | What the owner gets |
| --- | --- |
| `"off"` | nothing (the default) |
| `"each"` | an email soon after a new row, at most one per table per 10 minutes; rows created inside those 10 minutes are counted together in the next one |
| `"daily"` | one digest per UTC day that had new rows, sent in the first hour of the next UTC day |

- **Only other people's rows count.** Rows the owner creates — from their own surfaces, their agent or the app's backend server — never do.
- **The email goes to the owner's account email**, from the app's `@simple_email` address, billed to the owner and counted against the app's daily cap (the cap template sends share; freestyle sends have their own). It says how many rows arrived, in which table, over what period, and links to the app. It never carries a row's content, a submitter or a record id.
- **`"each"` and `"daily"` need the app's `@simple_email` account to be able to send**: the app has one and it has a sending address (the app has a subdomain label). Otherwise `error` is `400 email_not_ready` and the table keeps its value; `503 email_check_unavailable` means the check could not run and nothing changed. `"off"` always succeeds. The check sends nothing and costs nothing on `@simple_email`.
- **Every successful call resets the count**, the same value included: rows not yet reported are dropped, and `"off"` stops anything pending.
- **A send that is refused or fails is dropped**, never retried; the table keeps its value and the rows are unaffected. Creating rows is never slowed or refused by it.

```tsx
const setNewRowEmail = useSetNewRowEmail();
setNewRowEmail.mutate({ table: "inbox", new_row_email: "each" });
// no email account yet: setNewRowEmail.error is PilelyError { status: 400, code: "email_not_ready" }
```

### Record fields

Every record carries server-minted fields beside its columns: `id`, `_submitter_handle`, `_submitter_user_id` (absent from every answer to a signed-out visitor; `NIL_SUBMITTER_ID` with a `""` handle on a row a signed-out visitor created, the app's id on a row its backend server created), `_created_at_ms`, `_updated_at_ms`, and:

- `_version` — `1` on create, one more on every successful update (set, `inc` or both); a refused update leaves it unchanged. A record stored without a version reads `1`. Detect change with `_version`, never `_updated_at_ms` (two updates in one millisecond can share a stamp), and send it back as `ifVersion`.
- `_key` — the `key` a keyed create gave, verbatim, or `null`. It never changes, and every reader of the record sees it: never put private data (an email, a name, a secret) in a key on a table others read.

None of them can be written: naming one in a create's fields, a `patch`, `if` or `inc` is `400 bad_request`.

### Conditional writes, keys and counters

Each option is sent only when given; a call without them sends no option field.

- **`key` on create** — create-if-absent. `useCreateRecord("subscriptions", { key: buyerId })` sends a fixed key on every create; `{ key: (fields) => fields.event_id }` derives one per write (`undefined` sends none). A key is 1–200 characters from `A–Z a–z 0–9 _ - . : @ / +` and unique per table **per submitter**: the owner and the app's backend servers share one key space, each other signed-in user has their own, and a signed-out visitor has none (a `key` from one is `400 bad_request`). When the submitter already has a row with the key, nothing is created and `error` is `409 key_exists` with that row's id in `error.id`. Deleting the row frees the key.
- **`ifVersion` on update and delete** — the write applies only while the record's `_version` equals it; otherwise `409 version_conflict`, nothing changes, and `error.currentVersion` holds the record's version.
- **`if` on update** — `{ column: value | null }`, each column must read the value (the equality `useRecords`' `eq` uses; `null` matches a column that reads null), else `409 condition_failed`. At most 64 columns. `if: { holder: null }` with `patch: { holder: me }` claims a free slot exactly once.
- **`inc` on update** — `{ column: number }`, an atomic add on an `integer` (whole numbers) or `real` column, starting from the value a read returns (null starts from 0); concurrent increments never lose a count. `patch` may be `{}`. At most 64 columns, none also in `patch`; another column type, or a result outside the column's range, is `400 bad_request`.
- **`consistent` on `useRecord`** — `true` reads the record strongly consistently (every write that answered before the read started), for about twice the read capacity. It shares the record's cache entry.

A `409` is only ever answered to a caller allowed to make the write, on a record that exists: a refused caller or a missing record still gets the uniform 404. When `ifVersion` and an `if` both fail, the answer is `version_conflict`. `if`, `ifVersion` and `inc` reach the callers update and delete do: the owner, and a non-owner the table's `records/update` / `records/delete` policies admit on that record (an update's row before the change). Aimed at any other record they are the uniform 404, never a `400` or a `409`. An update the policies admit on the row before but whose row after no single policy holds on is the uniform 404 too, checked last: an `inc` out of range (`400`), a stale `ifVersion` or a failing `if` (`409`) answers first. A `key` is scoped to its submitter, as above.

```tsx
const update = useUpdateRecord<Slot>("slots");
update.mutate({ id: slot.id, patch: { holder: me }, if: { holder: null } });
// a lost race: update.error is PilelyError { status: 409, code: "condition_failed" }

const remove = useDeleteRecord("leases");
remove.mutate({ id: lease.id, ifVersion: lease._version });
```

### Sorts: choose them when you design the table

A table declares 0 to 3 **sorts**, the orders `useRecords` can read it in: each a `text`, `integer`, `real` or `boolean` column, `"_created_at_ms"` (creation order) or `"_updated_at_ms"`, usable ascending and descending. Decide them in `useCreateTable` (`sorts`), as part of the table's design — one per order the app actually lists in, and no more:

- **Each sort costs on every write and in storage.** Every record is stored once more per sort (`(1 + sorts) × (size + 100)` bytes) and every create, update and delete writes each sort's copy. Left out, `sorts` is `["_created_at_ms"]` (newest first, one sort: it costs what every table cost before sorts existed); `[]` declares none, creation order included (half that storage; the table lists in a stable but unspecified order).
- **List in a declared sort instead of sorting in the page.** A page holds at most 100 records, so sorting in the browser is right up to one page and silently wrong after; a declared sort pages exactly however big the table grows.
- **Order.** Ascending puts records whose value reads `null` first, then the values — `false` before `true`, numbers numerically, text by its first 900 bytes in byte order (case-sensitive) — ties by `id` ascending; descending is the exact mirror. A column never written sorts as its `columns/add` default.
- **Change them with `useSetSorts`**, which replaces the whole list. A sort kept keeps working. A sort added to a table holding records reads `"building"` in every table object until every record is filled in (seconds to minutes; poll `useTables`), and `useRecords` with it is `400 bad_request` until then; on an empty table it is `"ready"` at once. A sort removed stops working at once. Every cursor issued before the call is refused, even when the call keeps the same sorts, so every list of the table reloads from its first page.

```tsx
const createTable = useCreateTable();
createTable.mutate({
  table: "cards",
  columns: [{ name: "title", type: "text" }, { name: "position", type: "integer" }],
  sorts: ["position", "_created_at_ms"],
});
// table.sorts: [{ by: "position", state: "ready" }, { by: "_created_at_ms", state: "ready" }]
```

### Paging records

`useRecords` loads one page at a time and `fetchNextPage` follows the service's cursor:

- `sort` — `{ by, dir }`: one of the table's `"ready"` sorts, `"asc"` or `"desc"`. Left out (with `order`), the table's first sort, descending — newest first on every table that keeps creation order. A sort the table does not declare, one still `"building"`, or any other shape is `400 bad_request`.
- `order` — `"newest"` or `"oldest"`: `_created_at_ms` descending or ascending, the same as `sort: { by: "_created_at_ms", dir }`, on a table whose sorts include `_created_at_ms` (`400` otherwise). `sort` and `order` together are `400`.
- `where` — a condition (`DbWhere`), ANDed with `eq`; see below.
- `limit` — 1..100 rows per page; the server defaults to 50.
- Lists in different sorts, directions or conditions are separate queries and never share a cache entry.
- A cursor continues only the walk that issued it: the same table, sort and direction, the same caller (every signed-out visitor is one caller) under the same admitting policies, and the table's sorts as they were. Anything else — a malformed or altered cursor, another table's, one sent by another caller, one from before a `useSetTableAccess` or any `useSetSorts` on the table since, or one in a format the service answered before — is `400 bad_request`; start again without one. A cursor is opaque: never build or read one. The hook keeps a list's cursor and options together for you; send the same `where` and `eq` on every page.
- **A page can hold fewer than `limit` rows, even none, while more exist.** A filtered read (`where` or `eq`, or a non-owner's list a policy filter limits) on a big table stops when its per-call read budget runs out and hands back a cursor to continue. `hasNextPage` stays `true` until the cursor is `null`, so keep calling `fetchNextPage` (or show a "More" button) through a short or empty page; only a `null` cursor ends the list.

### Filter with `where`

`where` takes DynamoDB's condition grammar. Each key is a field holding its operators (ANDed) or a bare value meaning `eq`; `and` and `or` hold arrays of conditions and `not` one:

```ts
const where = {
  position: { gte: 10, lt: 20 },
  done: false,
  or: [{ title: { begins_with: "Fix" } }, { tags: { contains: "urgent" } }],
};
```

- **Operators** — `eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `between` (`[low, high]`, both ends included), `in` (1 to 100 values), `begins_with`, `contains` (a substring), `is_null` (`true` / `false`). Per type: `text` takes every one, in byte order, case-sensitive; `integer` and `real` take `eq ne lt lte gt gte between in is_null`; `boolean` takes `eq ne in is_null`; `json` only `eq` and `is_null`; `file` only `is_null`.
- **Fields** — the table's columns, `_created_at_ms` and `_updated_at_ms`, and `_submitter_user_id` from a signed-in caller.
- **Every value is compared as a read returns it**: a column never written compares as its `columns/add` default, and `is_null: true` matches a field that reads `null`.
- **`400 bad_request`** for an unknown field, a disallowed operator, a value of the wrong type or `null` (use `is_null`), an empty `in`, `and` or `or`, an empty condition `{}` inside `and`, `or` or `not`, more than 100 `in` values, a `between` whose low is above its high, or a condition (`where` and `eq` together) over DynamoDB's limits of 4 KB rendered and 300 operators. A top-level `where: {}` is no condition.
- **Cost.** A range on the column the list is sorted by — `eq`, `lt`, `lte`, `gt`, `gte`, `between` or, on a `text` sort, `begins_with`, ANDed at the top level — reads, and is billed for, only the records in the range. Every other condition reads the records in order and drops the ones it does not hold on: it is billed for every record it read.

### Count with `useRecordCount`

`useRecordCount(table, { sort?, order?, where?, eq? })` answers how many records the same `useRecords` list would hold, with the caller's access applied, from `records/list`'s `count: true`. On a big table the service counts in parts, each billed for the records it read; the hook adds every part up (`countRecords` in the API does the same), and no count is stored. It refreshes after every record write on the table. Prefer it to walking the records for "how many".

```tsx
const { data: cards, hasNextPage, fetchNextPage } = useRecords<Card>("cards", {
  sort: { by: "position", dir: "asc" },
  where: { done: false },
});
const { data: open } = useRecordCount("cards", { where: { done: false } });
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
| record create / update / delete on table `T` | every `useRecords(T, …)` and `useRecordCount(T, …)`; for update / delete also every `useRecord(T, id, …)` and `useFileUrl(T, id, …)` |
| table create / add column | every `useTables(…)` page |
| set sorts on table `T` | every `useTables(…)` page and every record query of `T` |
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
| create on `T` | a row with a temporary id, the submitted fields but its `File`s, `_created_at_ms` = now and the signed-in user as submitter, in every cached `useRecords(T, …)` whose `eq` and `where` it holds on, where the list's sort and direction put it among the loaded rows (a field it does not set reads `null`: first ascending, last descending; ties by `id`) — the top of a newest-first list. A row that sorts after every loaded row shows only in a list that has loaded its last page; one with pages still to load gains it when the refresh lands. A list with neither `sort` nor `order` is placed as newest first, the default of a table whose first sort is creation order |
| update `id` on `T` | the patch, wherever the record is cached; a filtered list (`eq` or `where`) it no longer matches drops it, a list it now matches gains it only when the refresh lands. An `inc` column, a `File` in a file field and `_version` are not changed at once: they show when the refresh lands |
| delete `id` on `T` | the record leaves every `useRecords(T, …)` and `useRecord(T, id)` clears |

- **Opt out** with `{ optimistic: false }` — `useCreateRecord<Post>("posts", { optimistic: false })` — for a flow that must show only what the server confirmed.
- **The optimistic placement is an estimate.** A list with neither `sort` nor `order` is placed as creation order, newest first, whatever the table's first sort is; a column the new row never wrote reads `null` there, not its `columns/add` default; and an update keeps the row at its old position, even in a list sorted by the patched column or by `_updated_at_ms`. The refresh puts each row where the server reads it.
- **The server always has the last word.** Every write ends by refreshing the queries in the table above, once no other record write on the same table is still in flight. The server's id, timestamps, submitter fields and column defaults replace the optimistic row then.
- **Render a refused write's error.** A refused write is a bare 404 (no policy of the API admits the caller or none holds on the row — before or after an update included — a `deny_group` member, or a signed-out visitor's update or delete), a `400` (a signed-out visitor's `key`), or one of the three `409`s when a `key`, `ifVersion` or `if` did not hold. The row rolls back and the hook's `error` holds the `PilelyError` until the next attempt or `reset()` — show it, as the example does, so the user knows why their post disappeared.
- **Show edit and delete controls only to who may use them.** `records/update` and `records/delete` are the owner's, plus whoever the table's `records/update` / `records/delete` policies admit on that record — never a signed-out visitor. Anyone else's optimistic edit always rolls back.
- **Temporary ids start with `pilely-temp-`** (exported as `TEMP_ID_PREFIX`). Use it to dim a pending row. When the real record arrives, a component keyed by `id` re-mounts once: keep no input state inside a just-created row. Updating or deleting a pending row is safe — the hook waits for the create and sends the real id, or sends nothing if the create failed. `useRecord` with a temporary id stays disabled.
- Overlapping writes never undo each other: a refused write rolls back only its own row, its own fields, or its own removal.

## Query keys

| Key | Query |
| --- | --- |
| `["pilely", "simple-db", "records", table, "list", { eq, limit, sort, order, where, file_urls }]` | `useRecords` |
| `["pilely", "simple-db", "records", table, "list", { eq, sort, order, where, count: true }]` | `useRecordCount` |
| `["pilely", "simple-db", "records", table, "get", id]` | `useRecord` (with `fileUrls`, one more element: `{ file_urls: true }`) |
| `["pilely", "simple-db", "records", table, "file", id, column]` | `useFileUrl` |
| `["pilely", "simple-db", "tables", { limit, cursor }]` | `useTables` |
| `["pilely", "simple-db", "apps", { limit, cursor }]` | `useDbApps` |

## Tearing a database down

`useDeleteDbApp()` drops every table, every record and the registry rows behind them. There is no undo: a create afterwards gives an empty database, not the old one. Its one option, `pile_row_exists`, defaults to `true` and is only `false` in the account-deletion sweep.

## Mock mode

Importing this package in a build made with `VITE_PILELY_MOCK=1` registers an in-browser fake of `simple_db` behind `@pilely/core`'s mock runtime — nothing else to call. The hooks then answer from memory with the JSON the real service returns.

The fake models apps, tables and records, persisted to `localStorage` across reloads. An app or table that does not exist is created on first use, so mock mode needs no create step. Rows carry the same `_submitter_*`, timestamp, `_version` and `_key` fields, lists page with the service's cursors (its pages are always full until the last), a missing row answers the bare 404, and a taken name answers `db_already_exists`, `table_exists` or `column_exists` (409).

Record writes follow the service's rules: `_version` starts at 1 and rises by one per update; a keyed create is unique per submitter (the signed-in mock user) and answers `409 key_exists` with the existing `id`; `ifVersion`, `if` and `inc` answer the same `400`s and `409`s (with `current_version`) as the service, in the same order; and an unknown body field on a record route (a misspelled `ifVersion`) is `400 bad_request`. An `inc` or `if` on a column the fake has not seen yet reads it as null, and an `inc` types it from the number. Every read is already consistent. `eq` on `_submitter_user_id` filters, and is `400` signed out. Every table reads `new_row_email: "off"` until `notify/set` changes it; `notify/set` refuses the service's `400`s (a missing key, a non-string, a value other than `"off"`, `"each"` or `"daily"`) and stores and echoes the value. The fake has no email service: it never answers `email_not_ready` or `email_check_unavailable`, accepts `"each"` and `"daily"` without checking an email account, and never sends anything — test the not-ready path against the real service. It does not model quotas or rate limits.

Access answers like the service's policies. `useCreateTable` and `useSetTableAccess` take `policies` and `deny_group` with the service's `400`s and reasons — each removed setting named with its replacement, before anything else; a key that is not one of the seven, an empty list, a policy that is not exactly `{ group, rows }`, a malformed group id, every filter checked against the table's columns (operators per type, operand types, `$$CALLER_ID` on text only, DynamoDB's limits); a platform-wide group as `deny_group` — and every table object shows them. The record and file hooks admit callers by them:

- **The owner bypasses every policy.** The owner is the person whose handle is the app's `owner_handle` — the mock user, who creates the app on first use — so a mock session signed in as the mock user reaches everything, as the owner does on the service.
- **The two platform-wide groups hold callers by type**: every signed-out visitor is in the anonymous group, every signed-in person in the authenticated group, a backend app in neither; `CALLER_ID` stands for the mock identity's id (a person's user id, a backend app's app id) and is false for a signed-out visitor.
- **Any other group holds nobody.** The fake has no group membership data (it does not read `@pilely/simple-group`'s fake), so a policy naming your own group admits no one and a `deny_group` denies no one; the group's ownership and activity are not checked either, any well-formed id is accepted. Test staff and ban paths against the real service.
- **Signed-out visitors** list, get, download, create (stamped `NIL_SUBMITTER_ID` and `""`; `key` is `400`) and upload where the policies admit them, never update or delete, and never see `_submitter_user_id`. Sign the mock user out (`signOut()` on `usePilelyAuth`) to try a signed-out flow.
- **A table created on first use is open**: the authenticated group with `{}` on every API and the anonymous group on the three read APIs, so mock mode needs no `useCreateTable` and signed-out pages can read. A table made with `useCreateTable` follows the policies it was given — owner-only without any. A table persisted by an older version of the fake reads the policies the service's migration gave its old settings.

Sorts and lists answer like the service. `tables/create` and `sorts/set` take `sorts` with the service's `400`s, and every table object shows each sort's state; a sort added to a table holding rows reads `"building"` (and `useRecords` with it is `400`) until `useTables` is next read — the fake's stand-in for the fill-in — and a removed sort is refused at once. `records/list` reads in `sort`, `order` or the table's first sort descending, with nulls first and ties by `id` (a table with no sorts in `id` order); holds `eq` and `where`, every operator per column type, on the value a read returns (a column never written reads its `columns/add` default); refuses every shape the service refuses, DynamoDB's 4 KB / 300-operator limits (the admitting policies' filters counted in) included; answers `count: true` in parts of up to 1000 rows read; and binds each cursor to its table, its caller (a person, a backend app, or every signed-out visitor as one), the policies that admitted the caller (the whole table for the owner), its sort and direction, and the table's sorts (any `sorts/set` voids it), refusing anything else with the service's `400` and reason. The fake's cursors are not sealed like the service's, but treat them as opaque all the same; it refuses the service's cursors and every older form as malformed. A column a table created on first use has not seen yet is untyped in `where` and `eq`: any operator and value, reading `null`; on a table made with `useCreateTable` an unknown field is `400`, as on the service.

File columns work end to end without a network: `upload/start` answers a ticket, the upload hands the bytes to the fake instead of a storage host, and a record write attaches a ticket by the service's rules — once, only by the caller who started it (every signed-out visitor is one caller), only for its own table and column, never with nothing uploaded (`400`), and a `PUT` after its 5-minute link or with another `Content-Type` is `upload_failed`. An upload started into a column the fake has not seen makes it a `file` column. `fileUrls` and `useFileUrl` answer `blob:` links, `null`, a replaced file and a deleted record or database drop the bytes. Records persist across reloads but file bytes are memory-only: after a reload a file field keeps its `DbFile` and has no link (`useFileUrl` answers the bare 404). The fake has no storage allowance and never answers `storage_exceeded` or `quota_unavailable`.

A refused write answers the uniform bare 404, so an optimistic write the policies refuse (a signed-out create on a table whose `records/create` policies do not name the anonymous group, a first-use table's included) appears, rolls back and leaves `PilelyError(404)` in `error`. The fake answers at once, so a pending state is never visible in mock mode. See [`@pilely/core`](../core#mock-mode) for the switch, `seedMock()` and `resetMock()`.

## Error codes

Refusals arrive as `PilelyError` in the hook's `error`, with a `code` drawn from `SimpleDbErrorCode`. Match on the code, never on the status. `error.id` and `error.currentVersion` carry the extra field of `key_exists` and `version_conflict`, and are `undefined` otherwise:

| Code | Status | Means |
| --- | --- | --- |
| `null` | 404 | the bare uniform 404 — denied and nonexistent are indistinguishable by design |
| `not_found` / `app_not_found` | 404 | the same hide, with an envelope |
| `db_already_exists` | 409 | the app already has a database |
| `table_exists` / `column_exists` | 409 | the name is taken |
| `key_exists` | 409 | a keyed create whose submitter already has a row with that key; nothing was created and `error.id` is that row's id |
| `version_conflict` | 409 | an `ifVersion` that is not the record's `_version`; nothing changed and `error.currentVersion` is the record's version |
| `condition_failed` | 409 | an `if` that does not hold (and `ifVersion`, when sent, matched); nothing changed |
| `email_not_ready` | 400 | `useSetNewRowEmail` with `"each"` or `"daily"` while the app's `@simple_email` account cannot send: there is none or it has no sending address; the reason names which, and the table keeps its value |
| `bad_request` | 400 | an upload ticket that is not usable (unknown, used, expired, another caller's, another table's or column's — one answer for all) or that nothing was uploaded to, a file field value other than a `File` / `Blob` or `null`, `upload/start` on a column that is not a file column, a `file` column in `eq`, `if` or `inc`, malformed body, a `new_row_email` that is missing or not `"off"`, `"each"` or `"daily"`, an unknown body field on a record route, a removed access setting (`read_group`, `write_group`, `anon_read`, `read_scope`, `mutate_scope`, `mutate_group`, `audience_column` — the reason names its replacement), `useSetTableAccess` without `policies` or `deny_group`, `policies` that is not an object, a policy key that is not one of the seven, an empty policy list, a policy that is not exactly `{ group, rows }`, a policy group that is neither an ACTIVE group you own nor a platform-wide group, a `deny_group` that is empty or not an ACTIVE group you own, a `rows` filter outside the syntax, naming an unknown field, with an operator its type does not take or a wrongly typed value, or over DynamoDB's limits on its own, a `key` from a signed-out visitor, `eq` on `_submitter_user_id` signed out or with a value that is not a user id, a records cursor issued to another caller or under other access policies, for another table, sort or direction, or before any `sorts/set` on the table since, a list `limit` outside 1..100, a malformed `cursor`, a `records/list` `order` other than `"newest"` or `"oldest"` or on a table without `_created_at_ms` among its sorts, a `sort` that is not `{ by, dir }`, names no sort of the table or one still `"building"`, `sort` and `order` together, a `where` with an unknown field, a disallowed operator, a value of the wrong type or `null`, an empty `in`, `and` or `or`, an empty `{}` inside `and`, `or` or `not`, more than 100 `in` values or a `between` low above its high, a list condition (with the admitting policies' filters) over 4 KB or 300 operators, a non-owner's `useDeleteRecord` whose admitting `records/delete` policies' filters, together with the delete's own conditions, render over DynamoDB's expression limits (the fake does not check this one), `sorts` that is not 0 to 3 names of `text` / `integer` / `real` / `boolean` columns, `_created_at_ms` or `_updated_at_ms` without a repeat, a malformed `key` or `ifVersion`, an update changing no column, an `inc` on a column that is not `integer` / `real`, also in `patch`, or leaving the column's range, more than 64 `if` or `inc` columns, or a reserved field written |
| `unauthenticated` | 401 | no usable token |
| `bad_forwarded_identity` | 401 | the forwarded-identity header did not verify |
| `rate_limited` | 429 | over a `@simple_limiter` policy the app's owner set on this database; root answers it with a `Retry-After` header |
| `internal` | 500 | reads retry it automatically |
| `email_check_unavailable` | 503 | `useSetNewRowEmail` could not check the app's email account; nothing changed — retry shortly |
| `out_of_traffic_credits` | 503 | your account has no traffic balance left; top up. Shown to the database owner only — everyone else gets the uniform 404 |
| `storage_exceeded` | 402 | the owner's storage allowance cannot hold a new record, a growing update, an upload or a file's attach; on the file paths shown to the owner only — everyone else gets the uniform 404 |
| `quota_unavailable` | 503 | the storage allowance could not be checked before a write, an upload or an attach; nothing changed — retry shortly |
| `file_too_large` | 413 | a file over 2 GB: refused by this package before anything is sent, or by the service at attach; nothing changed |
| `challenge_required` | 403 | root's, not the service's: a challenge policy the app's owner set matches this call and it carried no `challenge` (`### Bot checks: { challenge }`); nothing reached the service |
| `challenge_failed` | 403 | root's: the `challenge` sent was malformed, wrong, expired, started through another app, or already used; get and solve a new one |
| `upload_failed` | the storage host's, or `0` | minted by this package, never the service: the storage host refused the file's `PUT` (an expired link, for one), or the `PUT` never reached it (offline, a CORS refusal: `0`); no record was written |

## Install

```sh
npm install @pilely/simple-db @pilely/core @tanstack/react-query
```

`@pilely/core`, `react` (`^18.3 || ^19`) and `@tanstack/react-query` (`^5`) are peer dependencies. Always install with the scope — unscoped names like `pilely-db` are not owned by this project. This is a pre-1.0 package and moves with the platform.
