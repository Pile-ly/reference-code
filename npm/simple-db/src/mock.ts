// The in-browser fake of the simple_db service that `@pilely/core`'s mock
// runtime routes to in mock mode. It answers every route this package's
// wrapper calls with the JSON the real service returns. It models shape,
// not policy: tables, records and apps live in memory (and persist through
// the core store), an app or table that does not exist is created on first
// use, and every signed-in user may read and write everything. Writes need
// a signed-in user; a signed-out write and a missing app, table or record
// answer the uniform bare 404. Reached only from the `isMockMode()` branch
// in index.ts, so a production build carries none of it.

import type { MockReply, MockServiceContext, MockServiceFactory, MockSeed } from "@pilely/core";

import type { DbApp, DbColumn, DbColumnType, DbTable } from "./types.js";

const MARKER = "pilely-mock-fake:simple-db";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

type Row = Record<string, unknown> & {
  id: string;
  _submitter_user_id: string;
  _submitter_handle: string;
  _created_at_ms: number;
  _updated_at_ms: number;
};

interface TableState extends DbTable {
  /** Created by first use rather than `tables/create`. */
  implicit: boolean;
  records: Row[];
}

interface AppState extends DbApp {
  implicit: boolean;
  tables: Record<string, TableState>;
}

interface DbState {
  apps: Record<string, AppState>;
}

const RESERVED = new Set([
  "id",
  "_submitter_user_id",
  "_submitter_handle",
  "_created_at_ms",
  "_updated_at_ms",
]);

function inferType(value: unknown): DbColumnType {
  if (typeof value === "string") return "text";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "real";
  return "json";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Newest first: `_created_at_ms` DESC, then `id` DESC — the service's order. */
function newestFirst(a: Row, b: Row): number {
  if (a._created_at_ms !== b._created_at_ms) return b._created_at_ms - a._created_at_ms;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

function tablePayload(table: TableState): DbTable {
  return {
    name: table.name,
    read_group: table.read_group,
    write_group: table.write_group,
    anon_read: table.anon_read,
    created_at_ms: table.created_at_ms,
    columns: table.columns.map((c) => ({ name: c.name, type: c.type })),
  };
}

function appPayload(app: AppState): DbApp {
  return {
    app_id: app.app_id,
    owner_handle: app.owner_handle,
    created_time_stamp: app.created_time_stamp,
  };
}

/** The record as the service renders it: `id`, every column in registry
 *  order (`null` when absent), then the reserved stamps. */
function recordPayload(table: TableState, row: Row): Record<string, unknown> {
  const out: Record<string, unknown> = { id: row.id };
  for (const column of table.columns) {
    out[column.name] = column.name in row ? row[column.name] : null;
  }
  out._submitter_user_id = row._submitter_user_id;
  out._submitter_handle = row._submitter_handle;
  out._created_at_ms = row._created_at_ms;
  out._updated_at_ms = row._updated_at_ms;
  return out;
}

export const createSimpleDbFake: MockServiceFactory = (ctx: MockServiceContext) => {
  const state: DbState = ctx.load<DbState>() ?? { apps: {} };
  const save = () => ctx.save(state);

  function ensureApp(appId: string): AppState {
    let app = state.apps[appId];
    if (!app) {
      app = {
        app_id: appId,
        owner_handle: ctx.user()?.handle ?? "mock_user",
        created_time_stamp: ctx.now(),
        implicit: true,
        tables: {},
      };
      state.apps[appId] = app;
    }
    return app;
  }

  function ensureTable(app: AppState, name: string): TableState {
    let table = app.tables[name];
    if (!table) {
      table = {
        name,
        read_group: null,
        write_group: null,
        anon_read: false,
        created_at_ms: ctx.now(),
        columns: [],
        implicit: true,
        records: [],
      };
      app.tables[name] = table;
    }
    return table;
  }

  /** Adds a column for every field the table does not know yet, typed from
   *  the value — the mock's stand-in for a provisioning step. */
  function absorbFields(table: TableState, fields: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(fields)) {
      if (!RESERVED.has(name) && !table.columns.some((c) => c.name === name)) {
        table.columns.push({ name, type: inferType(value) });
      }
    }
  }

  function fieldsOf(body: unknown): { fields: Record<string, unknown> } | { refusal: MockReply } {
    const fields = isObject(body) ? body.fields : undefined;
    if (fields === undefined) return { fields: {} };
    if (!isObject(fields)) {
      return { refusal: ctx.refuse(400, "bad_request", "fields must be an object") };
    }
    for (const name of Object.keys(fields)) {
      if (RESERVED.has(name)) {
        return { refusal: ctx.refuse(400, "bad_request", `field "${name}" is reserved`) };
      }
    }
    return { fields };
  }

  function insert(table: TableState, fields: Record<string, unknown>): Row {
    absorbFields(table, fields);
    const user = ctx.user();
    const now = ctx.now();
    const row: Row = {
      ...fields,
      id: ctx.uuid(),
      _submitter_user_id: user?.id ?? "",
      _submitter_handle: user?.handle ?? "",
      _created_at_ms: now,
      _updated_at_ms: now,
    };
    table.records.push(row);
    return row;
  }

  function listRecords(table: TableState, body: unknown): MockReply {
    const options = isObject(body) ? body : {};
    const limit = options.limit === undefined ? DEFAULT_PAGE_SIZE : options.limit;
    if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      return ctx.refuse(400, "bad_request", "limit must be between 1 and 100");
    }
    let rows = [...table.records].sort(newestFirst);
    if (options.eq !== undefined) {
      if (!isObject(options.eq)) return ctx.refuse(400, "bad_request", "eq must be an object");
      const eq = options.eq;
      rows = rows.filter((row) =>
        Object.entries(eq).every(([column, value]) => sameValue(row[column] ?? null, value)),
      );
    }
    if (options.cursor !== undefined) {
      const match = typeof options.cursor === "string" ? /^(\d+):(.+)$/.exec(options.cursor) : null;
      if (!match) return ctx.refuse(400, "bad_request", "malformed cursor");
      const afterMs = Number(match[1]);
      const afterId = match[2] ?? "";
      rows = rows.filter(
        (row) => row._created_at_ms < afterMs || (row._created_at_ms === afterMs && row.id < afterId),
      );
    }
    // The service probes limit + 1 and hands back a cursor only when another
    // row exists.
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > limit && last ? `${last._created_at_ms}:${last.id}` : null;
    return ctx.ok({
      ok: true,
      records: page.map((row) => recordPayload(table, row)),
      next_cursor: nextCursor,
    });
  }

  function handle(path: string, body: unknown): MockReply | null {
    const parts = path.split("/").filter((p) => p !== "").map(decodeURIComponent);
    if (parts[0] !== "apps") return null;
    const signedIn = ctx.user() !== null;

    if (parts.length === 2 && parts[1] === "list") {
      const apps = Object.values(state.apps).map(appPayload);
      return ctx.ok({ ok: true, apps });
    }

    const appId = parts[1];
    if (appId === undefined) return null;
    const rest = parts.slice(2);
    const route = rest.join("/");

    if (route === "create") {
      if (!signedIn) return ctx.notFound();
      const existing = state.apps[appId];
      if (existing && !existing.implicit) {
        return ctx.refuse(409, "db_already_exists", "a database already exists for this app");
      }
      const app = ensureApp(appId);
      app.implicit = false;
      save();
      return ctx.ok({ ok: true, app: appPayload(app) });
    }

    if (route === "delete") {
      if (!signedIn) return ctx.notFound();
      if (!state.apps[appId]) return ctx.notFound();
      delete state.apps[appId];
      save();
      return ctx.ok({ ok: true, app_id: appId });
    }

    if (route === "tables/list") {
      const app = state.apps[appId];
      const tables = app ? Object.values(app.tables).map(tablePayload) : [];
      return ctx.ok({ ok: true, tables });
    }

    if (route === "tables/create") {
      if (!signedIn) return ctx.notFound();
      const input = isObject(body) ? body : {};
      if (typeof input.table !== "string" || input.table === "") {
        return ctx.refuse(400, "bad_request", "table is required");
      }
      const app = ensureApp(appId);
      const existing = app.tables[input.table];
      if (existing && !existing.implicit) {
        return ctx.refuse(409, "table_exists", "table already exists");
      }
      const table = ensureTable(app, input.table);
      table.implicit = false;
      table.read_group = typeof input.read_group === "string" ? input.read_group : null;
      table.write_group = typeof input.write_group === "string" ? input.write_group : null;
      table.anon_read = input.anon_read === true;
      if (Array.isArray(input.columns)) {
        for (const column of input.columns as DbColumn[]) {
          const known = table.columns.find((c) => c.name === column.name);
          if (known) known.type = column.type;
          else table.columns.push({ name: column.name, type: column.type });
        }
      }
      save();
      return ctx.ok({ ok: true, table: tablePayload(table) });
    }

    if (rest[0] !== "tables" || rest[1] === undefined) return null;
    const tableName = rest[1];
    const tail = rest.slice(2).join("/");

    if (tail === "access/set") {
      if (!signedIn) return ctx.notFound();
      const input = isObject(body) ? body : {};
      if (!("read_group" in input) || !("write_group" in input)) {
        return ctx.refuse(400, "bad_request", "read_group and write_group are required");
      }
      const table = ensureTable(ensureApp(appId), tableName);
      table.read_group = typeof input.read_group === "string" ? input.read_group : null;
      table.write_group = typeof input.write_group === "string" ? input.write_group : null;
      table.anon_read = input.anon_read === true;
      save();
      return ctx.ok({
        ok: true,
        table: table.name,
        read_group: table.read_group,
        write_group: table.write_group,
        anon_read: table.anon_read,
      });
    }

    if (tail === "columns/add") {
      if (!signedIn) return ctx.notFound();
      const input = isObject(body) ? body : {};
      if (typeof input.name !== "string" || typeof input.type !== "string") {
        return ctx.refuse(400, "bad_request", "name and type are required");
      }
      const table = ensureTable(ensureApp(appId), tableName);
      if (table.columns.some((c) => c.name === input.name)) {
        return ctx.refuse(409, "column_exists", "column already exists");
      }
      table.columns.push({ name: input.name, type: input.type as DbColumnType });
      if ("default" in input) {
        for (const row of table.records) {
          if (!(input.name in row)) row[input.name] = input.default;
        }
      }
      save();
      return ctx.ok({ ok: true, table: tablePayload(table) });
    }

    if (tail === "records/create") {
      if (!signedIn) return ctx.notFound();
      const parsed = fieldsOf(body);
      if ("refusal" in parsed) return parsed.refusal;
      const table = ensureTable(ensureApp(appId), tableName);
      const row = insert(table, parsed.fields);
      save();
      return ctx.ok({ ok: true, record: recordPayload(table, row) });
    }

    if (tail === "records/list") {
      const table = ensureTable(ensureApp(appId), tableName);
      return listRecords(table, body);
    }

    if (rest[2] !== "records" || rest[3] === undefined || rest.length !== 5) return null;
    const recordId = rest[3];
    const action = rest[4];
    const table = state.apps[appId]?.tables[tableName];
    const row = table?.records.find((r) => r.id === recordId);

    if (action === "get") {
      if (!table || !row) return ctx.notFound();
      return ctx.ok({ ok: true, record: recordPayload(table, row) });
    }
    if (action === "update") {
      if (!signedIn || !table || !row) return ctx.notFound();
      const parsed = fieldsOf(body);
      if ("refusal" in parsed) return parsed.refusal;
      absorbFields(table, parsed.fields);
      Object.assign(row, parsed.fields);
      row._updated_at_ms = ctx.now();
      save();
      return ctx.ok({ ok: true, record: recordPayload(table, row) });
    }
    if (action === "delete") {
      if (!signedIn || !table || !row) return ctx.notFound();
      table.records = table.records.filter((r) => r.id !== recordId);
      save();
      return ctx.ok({ ok: true, deleted: recordId });
    }
    return null;
  }

  function seed(input: MockSeed): void {
    if (!input.tables) return;
    const app = ensureApp(ctx.appId);
    for (const [name, rows] of Object.entries(input.tables)) {
      const table = ensureTable(app, name);
      for (const fields of rows) {
        const clean = Object.fromEntries(Object.entries(fields).filter(([k]) => !RESERVED.has(k)));
        const row = insert(table, clean);
        const user = ctx.user();
        row._submitter_user_id = user?.id ?? "mock-user";
        row._submitter_handle = user?.handle ?? "mock_user";
      }
    }
    save();
  }

  return { marker: MARKER, handle: (request) => handle(request.path, request.body), seed };
};

