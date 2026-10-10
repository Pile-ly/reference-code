// The simple_db service's 13 POST routes, one function each. This is the
// internal layer the hooks in hooks.ts call; the package exports the hooks,
// not these. Writes nest their fields under `fields`; reads answer flat
// records.

import { appId, call, collectPages, isMockMode, registerMockService } from "@pilely/core";

import { createSimpleDbFake } from "./mock.js";
import type {
  DbApp,
  DbAppsPage,
  DbColumnType,
  DbEqFilter,
  DbListPage,
  DbMutateScope,
  DbReadScope,
  DbRecord,
  DbRecordOrder,
  DbTable,
  DbTableAccess,
  DbTableNewRowEmail,
  DbTablesPage,
  NewRowEmail,
} from "./types.js";

// Importing this package (its hooks import this module) is all an app does
// to get its fake in mock mode. Dead code in a build without
// `VITE_PILELY_MOCK=1`, fake included.
if (isMockMode()) {
  registerMockService("simple-db", createSimpleDbFake);
}

/**
 * Every route on this service needs an app id in its path.
 * `@pilely/core`'s `appId()` can return `null` (no tag, `ready()` not yet
 * resolved) — a `null` interpolated into a path template would silently
 * become the literal string `"null"`. Fail loudly instead.
 */
function requireAppId(): string {
  const id = appId();
  if (!id) {
    throw new Error(
      'pilely client not loaded, <meta name="pilely-app"> missing, and no token pile_id claim available yet — call after ready()',
    );
  }
  return id;
}

/** `deleteApp`'s only option. Omit it entirely for the ordinary owner case —
 *  `@pilely/core` sends `{}`, which the service reads as the default. */
export interface DeleteAppOptions {
  /** Defaults to `true` server-side. Only the account-deletion sweep passes
   *  `false`, when the pile row is already gone. */
  pile_row_exists?: boolean;
}

/** The five row-level settings a write may send. Each is optional and sent
 *  only when given; `null` reads the default (`"all"`, no column,
 *  `"owner"`, no group, no group). */
export interface RowAccessBody {
  /** `"own"` shows a non-owner only the rows they submitted plus the rows
   *  addressed to them. `"own"` with `anon_read: true` is `400`. */
  read_scope?: DbReadScope | null;
  /** A `text` column declared in this table's `columns` that names the user
   *  a row is addressed to. Set only at `tables/create`: `access/set`
   *  accepts it only equal to the current value. */
  audience_column?: string | null;
  /** `"own"` lets a non-owner update and delete the rows they submitted. */
  mutate_scope?: DbMutateScope | null;
  /** An ACTIVE simple_group you own whose members read every row and
   *  update and delete any row. `null` is NO group — the opposite of
   *  `read_group` / `write_group`. An empty string is `400`. */
  mutate_group?: string | null;
  /** An ACTIVE simple_group you own whose members may not create, update
   *  or delete. `null` is NO group. An empty string is `400`. */
  deny_group?: string | null;
}

export interface CreateTableBody extends RowAccessBody {
  table: string;
  columns: { name: string; type: DbColumnType }[];
  /** `null` means every user (through the db's app) — always send the key. */
  read_group: string | null;
  write_group: string | null;
  /** Omitted means closed. `true` requires `read_group: null`. */
  anon_read?: boolean;
}

/** Always send both group keys: they and `anon_read` (omitted = `false`)
 *  are replaced. The five row-level keys are the exception — an omitted
 *  one keeps the table's current value, so a call that leaves them out
 *  never reopens an `"own"` table or lifts a ban. */
export interface SetAccessBody extends RowAccessBody {
  read_group: string | null;
  write_group: string | null;
  anon_read?: boolean;
}

export interface AddColumnBody {
  name: string;
  type: DbColumnType;
  /** Optional default for existing + future rows. Must match `type`. */
  default?: unknown;
}

export interface ListRecordsBody {
  /** Defaults server-side to 50 (not 100) when omitted — `listAllRecords`
   *  below always sends 100, the server's own cap. */
  limit?: number;
  cursor?: string;
  /** ANDed equality filters — reach for this before client-side filtering.
   *  Columns by name, plus `_submitter_user_id` (signed-in callers only). */
  eq?: DbEqFilter;
  /** `"newest"` (the server's default when omitted) or `"oldest"`. A cursor
   *  continues only the order that issued it; mixing them is `400
   *  bad_request`. */
  order?: DbRecordOrder;
}

/** `createRecord`'s options. Omitted, the create always inserts a new row. */
export interface CreateRecordOptions {
  /** Create-if-absent: 1–200 characters from `A–Z a–z 0–9 _ - . : @ / +`.
   *  When the submitter (the caller, or the owner for an owner or
   *  backend-server call) already has a row in this table with this key,
   *  nothing is created and the call throws `PilelyError` `409 key_exists`
   *  carrying that row's `id`. The row shows it as `_key` to every reader,
   *  so never put private data in it on a table others read. */
  key?: string;
}

/** `getRecord`'s options. Omitted, the read is eventually consistent. */
export interface GetRecordOptions {
  /** `true` reflects every write that answered before the read started, for
   *  about twice the read capacity. */
  consistent?: boolean;
}

/** `updateRecord`'s options: conditions and counters, applied in one atomic
 *  step with the `fields` change. */
export interface UpdateRecordOptions {
  /** The row's `_version` must equal it (an integer >= 1), else the call
   *  throws `409 version_conflict` carrying `currentVersion`. */
  ifVersion?: number;
  /** `{ column: value | null }`: each column must read the value (`eq`'s
   *  equality; `null` matches a column that reads null), else `409
   *  condition_failed`. At most 64 keys. */
  if?: Record<string, unknown>;
  /** `{ column: number }`: an atomic add on an `integer` (whole numbers) or
   *  `real` column, starting from the value a read returns (null starts
   *  from 0). At most 64 keys, none also in `fields`. */
  inc?: Record<string, number>;
}

/** `deleteRecord`'s options. Omitted, the delete is unconditional. */
export interface DeleteRecordOptions {
  /** The row's `_version` must equal it, else the call throws `409
   *  version_conflict` carrying `currentVersion` and the row is kept. */
  ifVersion?: number;
}

/** `listAllRecords`' options beyond the `eq` filter. */
export interface ListAllRecordsOptions {
  /** `"newest"` (the default) or `"oldest"`. */
  order?: DbRecordOrder;
}

/** The body of `tables/list` and `apps/list`. Omit it (or send `{}`) for
 *  the first page. */
export interface ListPageBody {
  /** 1..100; the server defaults to 50 when omitted. */
  limit?: number;
  /** The previous page's `nextCursor`, verbatim. */
  cursor?: string;
}

// ── Provisioning ──────────────────────────────────────────────────────────

/** This app's own database, as a one-row page (`apps: []` when it has none
 *  yet, or the caller is not its owner). A page always calls through its own
 *  app, and through an app the service never lists the owner's OTHER apps'
 *  databases, so `nextCursor` is always `null` here. */
export async function listApps(body: ListPageBody = {}): Promise<DbAppsPage> {
  const json = await call<{ apps: DbApp[]; next_cursor: string | null }>({
    service: "simple-db",
    path: "/apps/list",
    body,
  });
  return { apps: json.apps, nextCursor: json.next_cursor ?? null };
}

export async function createApp(): Promise<DbApp> {
  const json = await call<{ app: DbApp }>({
    service: "simple-db",
    path: `/apps/${requireAppId()}/create`,
  });
  return json.app;
}

/** Drops the app's database: every table, every record, and the registry rows
 *  behind them. There is no undo and no soft-delete tier — `createApp()` after
 *  this gives you an empty database, not the old one back.
 *
 *  `pile_row_exists` defaults to `true` and is only ever `false` in the
 *  account-deletion sweep, where the pile row has already been removed and the
 *  service must not try to re-read it. An ordinary owner never passes it.
 *
 *  Answers `{ok, app_id}` — the app row is gone, so unlike `createApp` there is
 *  no `DbApp` left to project. */
export async function deleteApp(options: DeleteAppOptions = {}): Promise<string> {
  const json = await call<{ app_id: string }>({
    service: "simple-db",
    path: `/apps/${requireAppId()}/delete`,
    body: { pile_row_exists: options.pile_row_exists },
  });
  return json.app_id;
}

export async function createTable(body: CreateTableBody): Promise<DbTable> {
  const json = await call<{ table: DbTable }>({
    service: "simple-db",
    path: `/apps/${requireAppId()}/tables/create`,
    body,
  });
  return json.table;
}

/** One page of the app's tables, oldest first. Follow `nextCursor` until it
 *  is `null` to see every one. */
export async function listTables(body: ListPageBody = {}): Promise<DbTablesPage> {
  const json = await call<{ tables: DbTable[]; next_cursor: string | null }>({
    service: "simple-db",
    path: `/apps/${requireAppId()}/tables/list`,
    body,
  });
  return { tables: json.tables, nextCursor: json.next_cursor ?? null };
}

export async function setTableAccess(table: string, body: SetAccessBody): Promise<DbTableAccess> {
  const json = await call<DbTableAccess>({
    service: "simple-db",
    path: `/apps/${requireAppId()}/tables/${table}/access/set`,
    body,
  });
  return {
    table: json.table,
    read_group: json.read_group,
    write_group: json.write_group,
    anon_read: json.anon_read,
    read_scope: json.read_scope,
    audience_column: json.audience_column,
    mutate_scope: json.mutate_scope,
    mutate_group: json.mutate_group,
    deny_group: json.deny_group,
  };
}

/** Sets whether the owner is emailed when other people create rows in
 *  `table`. `"each"` and `"daily"` need the app's `@simple_email` account to
 *  be able to send (an account with a sending address, and a verified phone)
 *  or the call throws `400 email_not_ready` and the table keeps its value;
 *  `"off"` always succeeds. Every successful call, the same value included,
 *  drops the rows not yet reported. Owner-only. */
export async function setNewRowEmail(table: string, value: NewRowEmail): Promise<DbTableNewRowEmail> {
  const json = await call<DbTableNewRowEmail>({
    service: "simple-db",
    path: `/apps/${requireAppId()}/tables/${table}/notify/set`,
    body: { new_row_email: value },
  });
  return {
    table: json.table,
    new_row_email: json.new_row_email,
  };
}

export async function addColumn(table: string, body: AddColumnBody): Promise<DbTable> {
  const json = await call<{ table: DbTable }>({
    service: "simple-db",
    path: `/apps/${requireAppId()}/tables/${table}/columns/add`,
    body,
  });
  return json.table;
}

// ── Records ───────────────────────────────────────────────────────────────

/** `fields` is required and always sent, even empty — the server tolerates
 *  an omitted key, but a record write with no fields is a caller mistake
 *  here, not a use case. `key` is sent only when given. */
export async function createRecord<T extends DbRecord>(
  table: string,
  fields: Record<string, unknown>,
  options: CreateRecordOptions = {},
): Promise<T> {
  const { key } = options;
  const json = await call<{ record: T }>({
    service: "simple-db",
    path: `/apps/${requireAppId()}/tables/${table}/records/create`,
    body: { fields, ...(key !== undefined ? { key } : {}) },
  });
  return json.record;
}

/** The paged primitive — one page, at most `limit` rows (server caps at
 *  100; an omitted `limit` gets only 50). A page can be shorter than `limit`,
 *  even empty, while `next_cursor` is a string: a filtered read stops when
 *  its per-call read budget runs out and hands back a cursor to continue.
 *  Only a `null` cursor ends a walk. Use `listAllRecords` to walk to the end. */
export async function listRecords<T extends DbRecord>(
  table: string,
  options: ListRecordsBody = {},
): Promise<DbListPage<T>> {
  const json = await call<{ records: T[]; next_cursor: string | null }>({
    service: "simple-db",
    path: `/apps/${requireAppId()}/tables/${table}/records/list`,
    body: options,
  });
  return { records: json.records, next_cursor: json.next_cursor };
}

/** Walks `records/list` to the end in `options.order` (newest first by
 *  default), always requesting the server's max page size (100) so this never
 *  silently doubles round-trips the way omitting `limit` would. Short and
 *  empty pages do not end the walk; only a `null` cursor does. */
export async function listAllRecords<T extends DbRecord>(
  table: string,
  eq?: DbEqFilter,
  options: ListAllRecordsOptions = {},
): Promise<T[]> {
  const { order } = options;
  return collectPages<T, string>(async (cursor) => {
    const page = await listRecords<T>(table, {
      limit: 100,
      ...(cursor ? { cursor } : {}),
      ...(eq ? { eq } : {}),
      ...(order ? { order } : {}),
    });
    return { rows: page.records, nextCursor: page.next_cursor };
  });
}

/** Without options `@pilely/core` sends `{}`, the default read;
 *  `consistent` is sent only when given. */
export async function getRecord<T extends DbRecord>(
  table: string,
  recordId: string,
  options: GetRecordOptions = {},
): Promise<T> {
  const { consistent } = options;
  const json = await call<{ record: T }>({
    service: "simple-db",
    path: `/apps/${requireAppId()}/tables/${table}/records/${recordId}/get`,
    ...(consistent !== undefined ? { body: { consistent } } : {}),
  });
  return json.record;
}

/** `fields` is required and always sent, mirroring `createRecord`; it may be
 *  `{}` when `inc` changes a column. Each option is sent only when given. */
export async function updateRecord<T extends DbRecord>(
  table: string,
  recordId: string,
  fields: Record<string, unknown>,
  options: UpdateRecordOptions = {},
): Promise<T> {
  const { ifVersion, if: conditions, inc } = options;
  const json = await call<{ record: T }>({
    service: "simple-db",
    path: `/apps/${requireAppId()}/tables/${table}/records/${recordId}/update`,
    body: {
      fields,
      ...(inc !== undefined ? { inc } : {}),
      ...(ifVersion !== undefined ? { if_version: ifVersion } : {}),
      ...(conditions !== undefined ? { if: conditions } : {}),
    },
  });
  return json.record;
}

/** Returns the deleted record's id, echoing the server's envelope. Without
 *  options `@pilely/core` sends `{}`, the unconditional delete. */
export async function deleteRecord(
  table: string,
  recordId: string,
  options: DeleteRecordOptions = {},
): Promise<string> {
  const { ifVersion } = options;
  const json = await call<{ deleted: string }>({
    service: "simple-db",
    path: `/apps/${requireAppId()}/tables/${table}/records/${recordId}/delete`,
    ...(ifVersion !== undefined ? { body: { if_version: ifVersion } } : {}),
  });
  return json.deleted;
}
