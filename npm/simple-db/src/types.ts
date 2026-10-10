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
 *  owner only, on any route, once their traffic balance is used up. */
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
  | "out_of_traffic_credits";

/**
 * Server-minted fields present on every record. `_submitter_user_id` is the
 * one reserved column that is not always on the wire: the server strips it
 * from every row read by a signed-out visitor of an `anon_read` table (an
 * `anon_read` table must not publish internal user ids to the whole
 * internet). `_submitter_handle` always stays — a public guestbook shows
 * who signed it. An app that renders `_submitter_user_id` will find it
 * `undefined` for exactly its signed-out readers, which is the hardest
 * case to notice in testing.
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

/** The closed set of column types simple_db accepts. */
export type DbColumnType = "text" | "integer" | "real" | "boolean" | "json";

export interface DbColumn {
  name: string;
  type: DbColumnType;
}

/** Which rows a non-owner reads: `"all"` (the default) every row their
 *  `read_group` lets them read; `"own"` only the rows they submitted plus
 *  the rows whose audience column holds their user id. The owner and the
 *  app's backend server always read every row. */
export type DbReadScope = "all" | "own";

/** Which rows a non-owner may update and delete: `"owner"` (the default)
 *  none; `"own"` the rows they submitted, while `write_group` admits them
 *  and `deny_group` does not hold them. */
export type DbMutateScope = "owner" | "own";

/** A table's five row-level settings. Every table carries all five; a
 *  table that never set them reads the defaults (`"all"`, `null`,
 *  `"owner"`, `null`, `null`): every permitted reader sees every row and
 *  only the owner updates and deletes. */
export interface DbRowAccess {
  read_scope: DbReadScope;
  /** A declared `text` column holding the user id a row is addressed to,
   *  or `null`. Set only at `tables/create`; it never changes. */
  audience_column: string | null;
  mutate_scope: DbMutateScope;
  /** Staff who read every row and update and delete any row. `null` means
   *  NO group — the opposite of `read_group` / `write_group`, where `null`
   *  is every user. */
  mutate_group: string | null;
  /** Banned users: their creates, updates and deletes answer the uniform
   *  404; their reads are unchanged. `null` means NO group, as for
   *  `mutate_group`. */
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

/** The full table object returned by create/list/columns-add. */
export interface DbTable extends DbRowAccess {
  name: string;
  /** `null` means every user (through the db's app), never "closed". */
  read_group: string | null;
  write_group: string | null;
  anon_read: boolean;
  /** `"off"` on every table that never set it. Changed only by
   *  `notify/set`, never by `tables/create` or `access/set`. */
  new_row_email: NewRowEmail;
  created_at_ms: number;
  columns: DbColumn[];
}

/** The narrower shape `access/set` answers with — `table` is a name here,
 *  not the object `create`/`list`/`columns/add` return. */
export interface DbTableAccess extends DbRowAccess {
  table: string;
  read_group: string | null;
  write_group: string | null;
  anon_read: boolean;
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

/** The order `records/list` reads a table in: `"newest"` (the default) is
 *  `_created_at_ms` descending, then `id` descending; `"oldest"` is the exact
 *  mirror. A cursor continues only the order that issued it. */
export type DbRecordOrder = "newest" | "oldest";

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
