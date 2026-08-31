// @pilely/simple-db — a typed wrapper over the simple_db service's 11 POST
// routes. See README.md for the writes-nest/reads-flat rule this package
// keeps honest.

import { appId, call, collectPages } from "@pilely/core";

import type { DbApp, DbColumnType, DbListPage, DbRecord, DbTable, DbTableAccess } from "./types.js";

export type {
  DbApp,
  DbColumn,
  DbColumnType,
  DbListPage,
  DbRecord,
  DbTable,
  DbTableAccess,
} from "./types.js";

export interface CreateTableBody {
  table: string;
  columns: { name: string; type: DbColumnType }[];
  /** `null` means every user (through the db's app) — always send the key. */
  read_group: string | null;
  write_group: string | null;
  /** Omitted means closed. `true` requires `read_group: null`. */
  anon_read?: boolean;
}

/** A full-set replace, not a patch — always send both group keys. */
export interface SetAccessBody {
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
  /** ANDed equality filters — reach for this before client-side filtering. */
  eq?: Record<string, unknown>;
}

// ── Provisioning ──────────────────────────────────────────────────────────

export async function listApps(): Promise<DbApp[]> {
  const json = await call<{ apps: DbApp[] }>({ service: "simple-db", path: "/apps/list" });
  return json.apps;
}

export async function createApp(): Promise<DbApp> {
  const json = await call<{ app: DbApp }>({
    service: "simple-db",
    path: `/apps/${appId()}/create`,
  });
  return json.app;
}

export async function createTable(body: CreateTableBody): Promise<DbTable> {
  const json = await call<{ table: DbTable }>({
    service: "simple-db",
    path: `/apps/${appId()}/tables/create`,
    body,
  });
  return json.table;
}

export async function listTables(): Promise<DbTable[]> {
  const json = await call<{ tables: DbTable[] }>({
    service: "simple-db",
    path: `/apps/${appId()}/tables/list`,
  });
  return json.tables;
}

export async function setTableAccess(table: string, body: SetAccessBody): Promise<DbTableAccess> {
  const json = await call<DbTableAccess>({
    service: "simple-db",
    path: `/apps/${appId()}/tables/${table}/access/set`,
    body,
  });
  return {
    table: json.table,
    read_group: json.read_group,
    write_group: json.write_group,
    anon_read: json.anon_read,
  };
}

export async function addColumn(table: string, body: AddColumnBody): Promise<DbTable> {
  const json = await call<{ table: DbTable }>({
    service: "simple-db",
    path: `/apps/${appId()}/tables/${table}/columns/add`,
    body,
  });
  return json.table;
}

// ── Records ───────────────────────────────────────────────────────────────

/** `fields` is required and always sent, even empty — the server tolerates
 *  an omitted key, but a record write with no fields is a caller mistake
 *  here, not a use case. */
export async function createRecord<T extends DbRecord>(
  table: string,
  fields: Record<string, unknown>,
): Promise<T> {
  const json = await call<{ record: T }>({
    service: "simple-db",
    path: `/apps/${appId()}/tables/${table}/records/create`,
    body: { fields },
  });
  return json.record;
}

/** The paged primitive — one page, at most `limit` rows (server caps at
 *  100; an omitted `limit` gets only 50). Use `listAllRecords` to walk to
 *  the end. */
export async function listRecords<T extends DbRecord>(
  table: string,
  options: ListRecordsBody = {},
): Promise<DbListPage<T>> {
  const json = await call<{ records: T[]; next_cursor: string | null }>({
    service: "simple-db",
    path: `/apps/${appId()}/tables/${table}/records/list`,
    body: options,
  });
  return { records: json.records, next_cursor: json.next_cursor };
}

/** Walks `records/list` to the end, always requesting the server's max
 *  page size (100) so this never silently doubles round-trips the way
 *  omitting `limit` would. */
export async function listAllRecords<T extends DbRecord>(
  table: string,
  eq?: Record<string, unknown>,
): Promise<T[]> {
  return collectPages<T, string>(async (cursor) => {
    const page = await listRecords<T>(table, {
      limit: 100,
      ...(cursor ? { cursor } : {}),
      ...(eq ? { eq } : {}),
    });
    return { rows: page.records, nextCursor: page.next_cursor };
  });
}

export async function getRecord<T extends DbRecord>(table: string, recordId: string): Promise<T> {
  const json = await call<{ record: T }>({
    service: "simple-db",
    path: `/apps/${appId()}/tables/${table}/records/${recordId}/get`,
  });
  return json.record;
}

/** `fields` is required and always sent, mirroring `createRecord`. */
export async function updateRecord<T extends DbRecord>(
  table: string,
  recordId: string,
  fields: Record<string, unknown>,
): Promise<T> {
  const json = await call<{ record: T }>({
    service: "simple-db",
    path: `/apps/${appId()}/tables/${table}/records/${recordId}/update`,
    body: { fields },
  });
  return json.record;
}

/** Returns the deleted record's id, echoing the server's envelope. */
export async function deleteRecord(table: string, recordId: string): Promise<string> {
  const json = await call<{ deleted: string }>({
    service: "simple-db",
    path: `/apps/${appId()}/tables/${table}/records/${recordId}/delete`,
  });
  return json.deleted;
}
