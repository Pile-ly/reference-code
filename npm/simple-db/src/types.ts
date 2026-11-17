/** Every `code` the simple_db service can put in a `{ok:false, code, reason}`
 *  refusal. Exhaustive as of the 2026-09 review, checked against the
 *  service's `response_json.rs` — not a guess.
 *
 *  `not_found` is the uniform hide: a denied read, a denied write and a row
 *  that never existed are indistinguishable by design, so never infer
 *  existence from it. Note the service uses `app_not_found` for the app
 *  subtree and plain `not_found` for tables and records — two codes, one
 *  meaning.
 *
 *  The three record-write `409`s are only ever answered to a caller allowed
 *  to make the write, on a row that exists: `key_exists` (a keyed create
 *  whose submitter already has a row with that key; the thrown
 *  `PilelyError` carries that row's `id`), `version_conflict` (an
 *  `ifVersion` that is not the row's `_version`; the error carries
 *  `currentVersion`) and `condition_failed` (an `if` that does not hold).
 *
 *  `email_not_ready` (400) and `email_check_unavailable` (503) are
 *  `notify/set`'s alone: turning `new_row_email` on needs the app's
 *  `@simple_email` account to be able to send, and a check that could not
 *  run changes nothing. `out_of_traffic_credits` (503) is shown to the DB
 *  owner only, on any route, once their traffic balance is used up.
 *
 *  `storage_exceeded` (402) is the owner's storage allowance refusing a
 *  create, a growing update, an `upload/start` or a file's attach; on the
 *  file paths every caller but the owner gets the uniform 404 instead.
 *  `quota_unavailable` (503) means the allowance could not be checked:
 *  retry shortly. `file_too_large` (413) is an attached upload over 2 GB.
 *
 *  `challenge_required` and `challenge_failed` (both 403) are root's, not
 *  the service's: a challenge policy guards the route and the call carried
 *  no answer, or a refused one.
 *
 *  `upload_failed` is the one code this package mints itself, never the
 *  service: the `PUT` of a file's bytes to the storage host was refused
 *  (its `status` is the storage host's) or never reached it — a network
 *  failure or a CORS refusal, `status` `0`. Nothing was written. */
export type SimpleDbErrorCode =
  | "unauthenticated"
  | "bad_forwarded_identity"
  | "bad_request"
  | "email_not_ready"
  | "not_found"
  | "app_not_found"
  | "db_already_exists"
  | "table_exists"
  | "column_exists"
  | "key_exists"
  | "version_conflict"
  | "condition_failed"
  | "rate_limited"
  | "internal"
  | "email_check_unavailable"
  | "out_of_traffic_credits"
  | "storage_exceeded"
  | "quota_unavailable"
  | "file_too_large"
  | "upload_failed"
  /** 403 — root's challenge check: a challenge policy the app's owner set
   *  on this route matches the call, and it carried no `challenge`. Nothing
   *  reached the service. */
  | "challenge_required"
  /** 403 — root's challenge check refused the `challenge` sent: malformed,
   *  wrong, expired, started through another app, or already used. Get and
   *  solve a new one (`@pilely/simple-limiter`) and send the call again. */
  | "challenge_failed";

/**
 * Server-minted fields present on every record. `_submitter_user_id` is the
 * one reserved column that is not always on the wire: the server strips it
 * from every answer to a signed-out visitor (a table whose policies let
 * signed-out visitors read must not publish internal user ids to the whole
 * internet). `_submitter_handle` always stays — a public guestbook shows
 * who signed it. An app that renders `_submitter_user_id` will find it
 * `undefined` for exactly its signed-out readers, which is the hardest
 * case to notice in testing. A row a signed-out visitor created holds
 * `NIL_SUBMITTER_ID` there and `""` as `_submitter_handle`; a row the app's
 * backend server created holds the app's id.
 *
 * `_version` is `1` on create and one more on every successful update;
 * detect change with it, never `_updated_at_ms` (two updates in one
 * millisecond can share a stamp), and send it back as `ifVersion`. `_key`
 * is the `key` a keyed create gave, verbatim, or `null`; it never changes
 * and every reader of the row sees it.
 */
export interface DbRecord {
  id: string;
  _submitter_handle: string;
  _submitter_user_id?: string;
  _created_at_ms: number;
  _updated_at_ms: number;
  _version: number;
  _key: string | null;
}

/** The closed set of column types simple_db accepts. A `file` column holds
 *  one file per record (`DbFile`), stored on the storage host. */
export type DbColumnType = "text" | "integer" | "real" | "boolean" | "json" | "file";

/**
 * A `file` field as every read answers it, or `null` when the field holds
 * no file. Declare a file column in a record type as `DbFile | null`.
 * `size_bytes` is the size the storage host received. `url` is present only
 * on a read made with `fileUrls: true`: a presigned download link valid 5
 * to 10 minutes, never worth storing. A field never shows an upload id or a
 * storage key.
 */
export interface DbFile {
  file_id: string;
  content_type: string;
  size_bytes: number;
  url?: string;
}

/** `upload/start`'s answer: where to `PUT` one file's bytes, and the ticket
 *  that attaches them to a record. Internal to the one-call write. */
export interface DbUploadTicket {
  /** 22 ASCII letters and digits; sent as `{ upload: upload_id }` in the
   *  file field of the record write. Works once, only for its caller, table
   *  and column. */
  upload_id: string;
  /** A presigned `PUT` link on the storage host, valid 5 minutes, straight
   *  to the file's own storage: the attach moves nothing. */
  upload_url: string;
  /** Epoch milliseconds: the end of `upload_url`'s validity. */
  expires_at: number;
}

/** The `download` route's answer: a fresh link for one record's file. */
export interface DbFileDownload {
  /** A presigned `GET` on the storage host, valid 5 to 10 minutes. */
  url: string;
  content_type: string;
  size_bytes: number;
}

export interface DbColumn {
  name: string;
  type: DbColumnType;
}

/** The `_submitter_user_id` of every row a signed-out visitor creates (its
 *  `_submitter_handle` is `""`). */
export const NIL_SUBMITTER_ID = "00000000-0000-0000-0000-000000000000";

/** As a value in a policy's `rows` filter (an operand of `$eq`, `$ne`, `$in`
 *  or `$nin` on a `text` field), the caller's id on each call: the person's
 *  user id, or the backend app's id. A signed-out visitor has none, so every
 *  comparison naming it is false for them. */
export const CALLER_ID = "$$CALLER_ID";

/** The seven record and file APIs that carry policies, in the order the
 *  service lists them. */
export const DB_POLICY_KEYS = [
  "records/list",
  "records/get",
  "files/download",
  "records/create",
  "records/update",
  "records/delete",
  "files/upload/start",
] as const;

/** One of the seven policy keys. What a policy's `rows` means on each:
 *  `records/list` only matching rows are returned and counted;
 *  `records/get` a row that does not match is the uniform 404;
 *  `files/download` the record holding the file must match (also what
 *  `fileUrls` signs a link for); `records/create` the new row must match;
 *  `records/update` the row before AND after the change must both match one
 *  policy; `records/delete` only a matching row may be deleted;
 *  `files/upload/start` only `group` decides (the row does not exist yet) —
 *  `rows` must still be sent and is not applied. */
export type DbPolicyKey = (typeof DB_POLICY_KEYS)[number];

/** One field's operators in a policy filter, ANDed. `$eq` `$ne` `$gt` `$gte`
 *  `$lt` `$lte` take `text`, `integer` and `real` (`$eq` / `$ne` also
 *  `boolean` and `json`); `$in` / `$nin` take 1 to 100 values on `text`,
 *  `integer`, `real` and `boolean`; `$exists` any field; `$not` an operator
 *  object, negated. A `file` field compares only with `null` (or
 *  `$exists`). `null` is an operand of `$eq`, `$ne`, `$in` and `$nin` only;
 *  `CALLER_ID` of those four on a `text` field. */
export interface DbFilterOperators {
  $eq?: unknown;
  $ne?: unknown;
  $gt?: string | number;
  $gte?: string | number;
  $lt?: string | number;
  $lte?: string | number;
  $in?: unknown[];
  $nin?: unknown[];
  $exists?: boolean;
  $not?: DbFilterOperators;
}

/**
 * A policy's `rows`: MongoDB query filter syntax over the row's columns and
 * the reserved fields `_submitter_user_id` (text), `_created_at_ms` and
 * `_updated_at_ms` (integer). Every key of one object is ANDed; a field
 * holds its operators or a bare value (`$eq`); `$and`, `$or` and `$nor`
 * hold non-empty arrays of filters. `{}` is every row. A filter holds on
 * the row as a read returns it: a column never written reads as its
 * declared default, and an explicit `null` counts as no value — so `$ne`,
 * `$nin`, `$not` and `$nor` match a row whose field reads `null`, and
 * `$gt` `$gte` `$lt` `$lte` and `$in` (without `null`) never do.
 * `{ _submitter_user_id: CALLER_ID }` is "only the rows I submitted".
 * Anything else (an unknown field, an operator the field's type does not
 * take, a wrongly typed value, another `$` operator, a top-level `$not`)
 * is `400` at `tables/create` / `access/set`.
 */
export interface DbFilter {
  $and?: DbFilter[];
  $or?: DbFilter[];
  $nor?: DbFilter[];
  [field: string]: DbFilterOperators | DbFilter[] | string | number | boolean | null | unknown[] | Record<string, unknown> | undefined;
}

/** One policy: who may call (`group` — a `@simple_group` group you own that
 *  is active, or one of the two platform-wide groups, whose ids
 *  `@simple_group` answers on `groups/anonymous` and `groups/authenticated`)
 *  and which rows the call reaches (`rows`). Both keys are required. */
export interface DbPolicy {
  group: string;
  rows: DbFilter;
}

/** A table's policies: for each API key a non-empty list, a caller admitted
 *  when ANY one policy matches (they are in its group AND the row satisfies
 *  its filter). A key left out is an owner-only API; `{}` an owner-only
 *  table. */
export type DbPolicies = Partial<Record<DbPolicyKey, DbPolicy[]>>;

/** A table's access, on every table answer: its `policies` and its
 *  `deny_group` — `null` (no group) or an active group you own, whose
 *  members get the uniform 404 on create, update, delete and upload
 *  whatever the policies say (their reads follow the policies). The owner
 *  bypasses every policy and is never denied. */
export interface DbAccess {
  policies: DbPolicies;
  deny_group: string | null;
}

/** Whether the app's owner is emailed when people other than the owner
 *  create rows in a table: `"off"` (the default) never; `"each"` soon after,
 *  at most one email per table per 10 minutes, each counting the rows since
 *  the last; `"daily"` one digest per UTC day that had new rows. The email
 *  goes to the owner's account email from the app's `@simple_email` account,
 *  billed and capped like any send from it, and carries only the count, the
 *  table, the app and a link — never a row's content. */
export type NewRowEmail = "off" | "each" | "daily";

/** A sort's state: `"ready"` lists in it; `"building"` (an added sort
 *  whose existing records are still being filled in) is refused by
 *  `records/list` until `tables/list` shows it ready. */
export type DbSortState = "building" | "ready";

/** One of a table's declared sorts, as every table answer shows it. `by`
 *  is a `text`, `integer`, `real` or `boolean` column, `"_created_at_ms"`
 *  (creation order) or `"_updated_at_ms"`. */
export interface DbTableSort {
  by: string;
  state: DbSortState;
}

/** The full table object returned by create/list/columns-add/sorts-set. */
export interface DbTable extends DbAccess {
  name: string;
  /** `"off"` on every table that never set it. Changed only by
   *  `notify/set`, never by `tables/create` or `access/set`. */
  new_row_email: NewRowEmail;
  /** The orders `records/list` reads the table in, 0 to 3, in declaration
   *  order; the first is the default (descending). Every table created
   *  without `sorts` has `[{ by: "_created_at_ms", state: "ready" }]`. */
  sorts: DbTableSort[];
  created_at_ms: number;
  columns: DbColumn[];
}

/** The narrower shape `access/set` answers with — `table` is a name here,
 *  not the object `create`/`list`/`columns/add` return — the access after
 *  the call and the table's sorts (unchanged by it). */
export interface DbTableAccess extends DbAccess {
  table: string;
  sorts: DbTableSort[];
}

/** The answer of `notify/set`: the table's name and its `new_row_email`
 *  after the call. */
export interface DbTableNewRowEmail {
  table: string;
  new_row_email: NewRowEmail;
}

/** `records/list`'s ANDed equality filters: declared columns by name, plus
 *  `_submitter_user_id` — a user id, from a signed-in caller only (a
 *  signed-out one gets `400 bad_request`). Every filter narrows within the
 *  rows the caller may see. No other reserved field is filterable. */
export type DbEqFilter = Record<string, unknown> & {
  _submitter_user_id?: string;
};

export interface DbApp {
  app_id: string;
  owner_handle: string;
  created_time_stamp: number;
}

/** Creation order for `records/list`: `"newest"` is `_created_at_ms`
 *  descending, then `id` descending; `"oldest"` is the exact mirror — the
 *  same as `sort: { by: "_created_at_ms", dir: "desc" | "asc" }`. It needs
 *  `_created_at_ms` among the table's sorts. */
export type DbRecordOrder = "newest" | "oldest";

export type DbSortDir = "asc" | "desc";

/** The order a `records/list` reads in: one of the table's ready sorts,
 *  ascending or descending. Ascending puts records whose value reads `null`
 *  first, then the values (`false` before `true`, numbers numerically, text
 *  by its first 900 bytes, case-sensitive), ties by `id` ascending;
 *  descending is the exact mirror. Left out, a list reads the table's first
 *  sort, descending. A cursor continues only the sort and direction that
 *  issued it. */
export interface DbSort {
  by: string;
  dir: DbSortDir;
}

/** One column's operators in a `where`, ANDed. Per type: `text` takes every
 *  one (byte order, case-sensitive; `contains` is a substring); `integer`
 *  and `real` take `eq ne lt lte gt gte between in is_null`; `boolean`
 *  takes `eq ne in is_null`; `json` only `eq` and `is_null`; `file` only
 *  `is_null`. A value must have the column's type and is never `null` (use
 *  `is_null`). */
export interface DbWhereOperators {
  eq?: unknown;
  ne?: unknown;
  lt?: string | number;
  lte?: string | number;
  gt?: string | number;
  gte?: string | number;
  /** `[low, high]`, both ends included; low may not be above high. */
  between?: [string | number, string | number];
  /** 1 to 100 values. */
  in?: unknown[];
  begins_with?: string;
  contains?: string;
  /** `true` matches a field that reads `null`. */
  is_null?: boolean;
}

/** A field's entry in a `where`: its operators, or a bare value meaning
 *  `eq`. */
export type DbWhereEntry = DbWhereOperators | string | number | boolean | unknown[];

/** `records/list`'s condition, ANDed with `eq`: each key a column (or
 *  `_created_at_ms`, `_updated_at_ms`, or `_submitter_user_id` from a
 *  signed-in caller) holding a `DbWhereEntry`, and `and` / `or` (arrays of
 *  conditions) and `not` (one) combining them. Every value is compared as a
 *  read returns it: a column never written compares as its declared
 *  default. A `where` range (`eq lt lte gt gte between`, or `begins_with` on
 *  a `text` sort) ANDed at the top level on the column the list is sorted
 *  by reads, and is billed for, only the records in the range; every other
 *  condition is billed for every record the list reads. */
export interface DbWhere {
  and?: DbWhere[];
  or?: DbWhere[];
  not?: DbWhere;
  [field: string]: DbWhereEntry | DbWhere | DbWhere[] | undefined;
}

/** One part of a `records/list` count. Add up the parts, passing
 *  `next_cursor` back as `cursor`, until it is `null`; a part may count
 *  zero while `next_cursor` is a string. */
export interface DbCountPart {
  count: number;
  next_cursor: string | null;
}

/** One page of `records/list`. `records` can hold fewer than `limit` rows,
 *  even none, while `next_cursor` is a string: only `null` means no more rows. */
export interface DbListPage<T> {
  records: T[];
  next_cursor: string | null;
}

/** One page of `tables/list`, oldest table first. `nextCursor` is `null` on
 *  the last page; otherwise pass it back as `cursor` for the next one. */
export interface DbTablesPage {
  tables: DbTable[];
  nextCursor: string | null;
}

/** One page of `apps/list`, newest database first. `nextCursor` is `null`
 *  on the last page; otherwise pass it back as `cursor` for the next one. */
export interface DbAppsPage {
  apps: DbApp[];
  nextCursor: string | null;
}
