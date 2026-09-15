/**
 * Server-minted fields present on every record. `_submitter_user_id` is the
 * one reserved column that is not always on the wire: the server strips it
 * from every row read by a signed-out visitor of an `anon_read` table (an
 * `anon_read` table must not publish internal user ids to the whole
 * internet). `_submitter_handle` always stays — a public guestbook shows
 * who signed it. An app that renders `_submitter_user_id` will find it
 * `undefined` for exactly its signed-out readers, which is the hardest
 * case to notice in testing.
 */
export interface DbRecord {
  id: string;
  _submitter_handle: string;
  _submitter_user_id?: string;
  _created_at_ms: number;
  _updated_at_ms: number;
}

/** The closed set of column types simple_db accepts. */
export type DbColumnType = "text" | "integer" | "real" | "boolean" | "json";

export interface DbColumn {
  name: string;
  type: DbColumnType;
}

/** The full table object returned by create/list/columns-add. */
export interface DbTable {
  name: string;
  /** `null` means every user (through the db's app), never "closed". */
  read_group: string | null;
  write_group: string | null;
  anon_read: boolean;
  created_at_ms: number;
  columns: DbColumn[];
}

/** The narrower shape `access/set` answers with — `table` is a name here,
 *  not the object `create`/`list`/`columns/add` return. */
export interface DbTableAccess {
  table: string;
  read_group: string | null;
  write_group: string | null;
  anon_read: boolean;
}

export interface DbApp {
  app_id: string;
  owner_handle: string;
  created_time_stamp: number;
}

export interface DbListPage<T> {
  records: T[];
  next_cursor: string | null;
}
