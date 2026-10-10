// The in-browser fake of the simple_db service that `@pilely/core`'s mock
// runtime routes to in mock mode. It answers every route this package's
// wrapper calls with the JSON the real service returns. It models shape,
// not policy: tables, records and apps live in memory (and persist through
// the core store), an app or table that does not exist is created on first
// use, and every signed-in user may read and write everything. Writes need
// a signed-in user; a signed-out write and a missing app, table or record
// answer the uniform bare 404. Record writes follow the service's write
// rules: `_version` and `_key` on every row, keyed creates unique per
// submitter, `if_version` / `if` / `inc` with their 400s and 409s, and
// unknown body fields refused. Tables store and answer the five row-level
// settings (`read_scope`, `audience_column`, `mutate_scope`, `mutate_group`,
// `deny_group`) with the service's defaults, shape 400s and keep-current
// `access/set`, but nothing reads them: no row scoping, no audience rule,
// no group lookups. Tables also store and answer `new_row_email` (`"off"`
// by default) through `notify/set`, but the fake has no email service: it
// accepts `"each"` and `"daily"` without the account check (never
// `email_not_ready`) and never sends anything. Reached only from the `isMockMode()` branch in
// index.ts, so a production build carries none of it.

import type { MockReply, MockServiceContext, MockServiceFactory, MockSeed } from "@pilely/core";

import type {
  DbApp,
  DbColumn,
  DbColumnType,
  DbMutateScope,
  DbReadScope,
  DbRecordOrder,
  DbRowAccess,
  DbTable,
  DbTableAccess,
  DbTableNewRowEmail,
  NewRowEmail,
} from "./types.js";

const MARKER = "pilely-mock-fake:simple-db";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

/** A record `key`: 1–200 characters from `A–Z a–z 0–9 _ - . : @ / +`. */
const RECORD_KEY = /^[A-Za-z0-9_\-.:@/+]{1,200}$/;
/** The most columns one update's `inc` or `if` may name. */
const MAX_CONDITION_KEYS = 64;
/** 2^63: an `integer` column holds -2^63 ..= 2^63 - 1. */
const INTEGER_LIMIT = 2 ** 63;

const CONDITION_FAILED_REASON = "a condition in `if` does not hold — the record was not changed";

/** The row-level settings of a table that never set them: no row-level
 *  rules at all. */
const DEFAULT_ROW_ACCESS: DbRowAccess = {
  read_scope: "all",
  audience_column: null,
  mutate_scope: "owner",
  mutate_group: null,
  deny_group: null,
};

/** The `new_row_email` of a table that never set it. */
const DEFAULT_NEW_ROW_EMAIL: NewRowEmail = "off";

const NEW_ROW_EMAIL_VALUES = '"off", "each" or "daily"';

/** A `mutate_group` / `deny_group` value: a nanoid's shape, ASCII letters
 *  and digits, at most 64 characters. */
const GROUP_REF = /^[A-Za-z0-9]{1,64}$/;

/** The only reserved field `records/list`'s `eq` accepts. */
const SUBMITTER_FILTER = "_submitter_user_id";

const OWN_SCOPE_ANON_READ_REASON =
  'read_scope "own" cannot be combined with anon_read: true — a signed-out visitor has no rows of their own; pass anon_read false or read_scope "all"';
const AUDIENCE_IMMUTABLE_REASON =
  "audience_column is set only at tables/create and never changes — send the current value or leave it out";

/** `_version` and `_key` are optional for a persisted row that lacks them;
 *  such a row reads `1` and `null`, as on the service. */
type Row = Record<string, unknown> & {
  id: string;
  _submitter_user_id: string;
  _submitter_handle: string;
  _created_at_ms: number;
  _updated_at_ms: number;
  _version?: number;
  _key?: string | null;
};

/** The row-level settings and `new_row_email` are optional for a persisted
 *  table that lacks them; such a table reads `DEFAULT_ROW_ACCESS` and
 *  `"off"`. */
interface TableState extends Omit<DbTable, keyof DbRowAccess | "new_row_email">, Partial<DbRowAccess> {
  new_row_email?: NewRowEmail;
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
  "_version",
  "_key",
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

/** `null` and an omitted field mean the same on the service: absent. */
function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/** Newest first: `_created_at_ms` DESC, then `id` DESC — the service's
 *  default record order. */
function newestFirst(a: Row, b: Row): number {
  if (a._created_at_ms !== b._created_at_ms) return b._created_at_ms - a._created_at_ms;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** Oldest first: `_created_at_ms` ASC, then `id` ASC — the exact mirror of
 *  `newestFirst`, the service's `"order": "oldest"`. */
function oldestFirst(a: Row, b: Row): number {
  if (a._created_at_ms !== b._created_at_ms) return a._created_at_ms - b._created_at_ms;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** `tables/list`'s order: `created_at_ms` ASC, then `name` ASC. */
function oldestTableFirst(a: TableState, b: TableState): number {
  if (a.created_at_ms !== b.created_at_ms) return a.created_at_ms - b.created_at_ms;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** `apps/list`'s order: `created_time_stamp` DESC, then `app_id` DESC. */
function newestAppFirst(a: AppState, b: AppState): number {
  if (a.created_time_stamp !== b.created_time_stamp) return b.created_time_stamp - a.created_time_stamp;
  return a.app_id < b.app_id ? 1 : a.app_id > b.app_id ? -1 : 0;
}

/** The `limit` of a list body: the default when omitted, `null` when it is
 *  not an integer in 1..100. */
function pageLimit(options: Record<string, unknown>): number | null {
  const limit = options.limit === undefined ? DEFAULT_PAGE_SIZE : options.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
    return null;
  }
  return limit;
}

/** A list cursor, `"<ms>:<key>"`, split — or `null` when malformed. */
function parseCursor(cursor: unknown): { ms: number; key: string } | null {
  const match = typeof cursor === "string" ? /^(\d+):(.+)$/.exec(cursor) : null;
  return match ? { ms: Number(match[1]), key: match[2] ?? "" } : null;
}

/** The prefix that marks a `records/list` cursor as oldest-first. */
const OLDEST_CURSOR_PREFIX = "o:";

/** The `order` of a `records/list` body: `"newest"` when omitted or `null`,
 *  and `null` when it is anything other than `"newest"` or `"oldest"`. */
function recordOrder(options: Record<string, unknown>): DbRecordOrder | null {
  const order = options.order ?? "newest";
  return order === "newest" || order === "oldest" ? order : null;
}

/** A `records/list` cursor bound to its order: `"<ms>:<id>"` newest first,
 *  `"o:<ms>:<id>"` oldest first. */
function recordCursor(order: DbRecordOrder, row: Row): string {
  const prefix = order === "oldest" ? OLDEST_CURSOR_PREFIX : "";
  return `${prefix}${row._created_at_ms}:${row.id}`;
}

/** A `records/list` cursor split into the order that issued it and the
 *  `(ms, id)` it resumes after — or `null` when malformed. A cursor without
 *  the `"o:"` prefix is newest-first. */
function parseRecordCursor(cursor: unknown): { order: DbRecordOrder; ms: number; key: string } | null {
  if (typeof cursor !== "string") return null;
  const oldest = cursor.startsWith(OLDEST_CURSOR_PREFIX);
  const after = parseCursor(oldest ? cursor.slice(OLDEST_CURSOR_PREFIX.length) : cursor);
  return after ? { order: oldest ? "oldest" : "newest", ...after } : null;
}

/** The table's five row-level settings, a missing one read as its
 *  default. */
function rowAccessOfTable(table: TableState): DbRowAccess {
  return {
    read_scope: table.read_scope ?? DEFAULT_ROW_ACCESS.read_scope,
    audience_column: table.audience_column ?? DEFAULT_ROW_ACCESS.audience_column,
    mutate_scope: table.mutate_scope ?? DEFAULT_ROW_ACCESS.mutate_scope,
    mutate_group: table.mutate_group ?? DEFAULT_ROW_ACCESS.mutate_group,
    deny_group: table.deny_group ?? DEFAULT_ROW_ACCESS.deny_group,
  };
}

function tablePayload(table: TableState): DbTable {
  return {
    name: table.name,
    read_group: table.read_group,
    write_group: table.write_group,
    anon_read: table.anon_read,
    ...rowAccessOfTable(table),
    new_row_email: table.new_row_email ?? DEFAULT_NEW_ROW_EMAIL,
    created_at_ms: table.created_at_ms,
    columns: table.columns.map((c) => ({ name: c.name, type: c.type })),
  };
}

/** `notify/set`'s answer: the table's name and its `new_row_email`. */
function newRowEmailPayload(table: TableState): DbTableNewRowEmail {
  return {
    table: table.name,
    new_row_email: table.new_row_email ?? DEFAULT_NEW_ROW_EMAIL,
  };
}

/** `notify/set`'s required `new_row_email`, as the service reads it — or the
 *  service's 400 reason for a missing key, a non-string or an unknown
 *  value. */
function newRowEmailOf(input: Record<string, unknown>): { value: NewRowEmail } | { reason: string } {
  const raw = input.new_row_email;
  if (raw === undefined || raw === null) {
    return { reason: `new_row_email is required: ${NEW_ROW_EMAIL_VALUES}` };
  }
  if (typeof raw !== "string") return { reason: `new_row_email must be a string: ${NEW_ROW_EMAIL_VALUES}` };
  if (raw !== "off" && raw !== "each" && raw !== "daily") {
    return { reason: `new_row_email must be ${NEW_ROW_EMAIL_VALUES}; got \`${raw}\`` };
  }
  return { value: raw };
}

/** `access/set`'s answer: the table's name and every access setting. */
function accessPayload(table: TableState): DbTableAccess {
  return {
    table: table.name,
    read_group: table.read_group,
    write_group: table.write_group,
    anon_read: table.anon_read,
    ...rowAccessOfTable(table),
  };
}

/** The row-level settings a `tables/create` or `access/set` body names, as
 *  the service reads them: an absent (or `undefined`, which JSON drops) key
 *  is absent from the result (the default on create, the current value on
 *  access/set), `null` is the
 *  default, and a value is checked for shape — `read_scope` `"all"` /
 *  `"own"`, `mutate_scope` `"owner"` / `"own"`, a group nanoid-shaped and
 *  never empty — or the service's 400 reason. Whether a group exists is not
 *  modelled; the audience column's rules need the table and are the
 *  caller's. */
function rowAccessUpdateOf(input: Record<string, unknown>): { update: Partial<DbRowAccess> } | { reason: string } {
  const update: Partial<DbRowAccess> = {};
  if (input.read_scope !== undefined) {
    const value = input.read_scope ?? DEFAULT_ROW_ACCESS.read_scope;
    if (value !== "all" && value !== "own") {
      return { reason: `read_scope must be "all" or "own" (or null); got \`${String(value)}\`` };
    }
    update.read_scope = value as DbReadScope;
  }
  if (input.mutate_scope !== undefined) {
    const value = input.mutate_scope ?? DEFAULT_ROW_ACCESS.mutate_scope;
    if (value !== "owner" && value !== "own") {
      return { reason: `mutate_scope must be "owner" or "own" (or null); got \`${String(value)}\`` };
    }
    update.mutate_scope = value as DbMutateScope;
  }
  if (input.audience_column !== undefined) {
    const value = input.audience_column ?? null;
    if (value !== null && typeof value !== "string") {
      return { reason: "audience_column must be a column name or null" };
    }
    update.audience_column = value;
  }
  for (const name of ["mutate_group", "deny_group"] as const) {
    if (input[name] === undefined) continue;
    const value = input[name] ?? null;
    if (value === "") {
      return { reason: `${name} is empty — pass a simple_group nanoid, or null for no group` };
    }
    if (value !== null && (typeof value !== "string" || !GROUP_REF.test(value))) {
      return {
        reason: `${name} must be a simple_group nanoid (ASCII letters/digits) or null (no group); got \`${String(value)}\``,
      };
    }
    update[name] = value;
  }
  return { update };
}

/** The rules on the settings a table would hold: `"own"` never beside
 *  `anon_read`, and an audience column only a declared `text` column. */
function rowAccessRefusal(settings: DbRowAccess, anonRead: boolean, columns: readonly DbColumn[]): string | null {
  if (settings.read_scope === "own" && anonRead) return OWN_SCOPE_ANON_READ_REASON;
  const audience = settings.audience_column;
  if (audience !== null && !columns.some((c) => c.name === audience && c.type === "text")) {
    return `audience_column must name a text column declared in columns; got \`${audience}\``;
  }
  return null;
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
  out._version = row._version ?? 1;
  out._key = row._key ?? null;
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
        ...DEFAULT_ROW_ACCESS,
        new_row_email: DEFAULT_NEW_ROW_EMAIL,
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

  /** The record route's body, holding only `allowed` fields — or the
   *  service's 400. No body reads as `{}`. */
  function bodyOf(body: unknown, allowed: readonly string[]): { body: Record<string, unknown> } | { refusal: MockReply } {
    if (body === undefined) return { body: {} };
    if (!isObject(body)) return { refusal: ctx.refuse(400, "bad_request", "the body must be a JSON object") };
    const unknown = Object.keys(body).find((name) => !allowed.includes(name));
    if (unknown !== undefined) {
      return { refusal: ctx.refuse(400, "bad_request", `unknown field "${unknown}"`) };
    }
    return { body };
  }

  /** `if_version`: absent, an integer >= 1, or the service's 400. */
  function ifVersionOf(body: Record<string, unknown>): { ifVersion: number | undefined } | { refusal: MockReply } {
    const value = body.if_version;
    if (!present(value)) return { ifVersion: undefined };
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
      return { refusal: ctx.refuse(400, "bad_request", `if_version must be an integer >= 1, got ${JSON.stringify(value)}`) };
    }
    return { ifVersion: value };
  }

  /** An optional object field (`inc`, `if`): `{}` when absent, or the
   *  service's 400 when it is not an object, names a reserved field or
   *  more than 64 columns. */
  function columnMapOf(
    body: Record<string, unknown>,
    name: string,
  ): { map: Record<string, unknown> } | { refusal: MockReply } {
    const value = body[name];
    if (!present(value)) return { map: {} };
    if (!isObject(value)) return { refusal: ctx.refuse(400, "bad_request", `${name} must be an object`) };
    const columns = Object.keys(value);
    const reserved = columns.find((column) => RESERVED.has(column));
    if (reserved !== undefined) {
      return { refusal: ctx.refuse(400, "bad_request", `field "${reserved}" is reserved`) };
    }
    if (columns.length > MAX_CONDITION_KEYS) {
      return { refusal: ctx.refuse(400, "bad_request", `${name} names more than ${MAX_CONDITION_KEYS} columns`) };
    }
    return { map: value };
  }

  function conflict(code: string, reason: string, extra: Record<string, unknown> = {}): MockReply {
    return ctx.ok({ ok: false, code, reason, ...extra }, 409);
  }

  function versionConflict(currentVersion: number): MockReply {
    return conflict(
      "version_conflict",
      `the record is at version ${currentVersion} — nothing was changed; read it again and retry`,
      { current_version: currentVersion },
    );
  }

  function fieldsOf(body: unknown): { fields: Record<string, unknown> } | { refusal: MockReply } {
    const fields = isObject(body) ? body.fields : undefined;
    if (!present(fields)) return { fields: {} };
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

  function insert(table: TableState, fields: Record<string, unknown>, key: string | null = null): Row {
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
      _version: 1,
      _key: key,
    };
    table.records.push(row);
    return row;
  }

  function listRecords(table: TableState, body: unknown): MockReply {
    const options = isObject(body) ? body : {};
    const limit = pageLimit(options);
    if (limit === null) return ctx.refuse(400, "bad_request", "limit must be between 1 and 100");
    const order = recordOrder(options);
    if (order === null) return ctx.refuse(400, "bad_request", 'order must be "newest" or "oldest"');
    // A cursor continues only the order that issued it.
    let after: { ms: number; key: string } | null = null;
    if (options.cursor !== undefined && options.cursor !== null) {
      const parsed = parseRecordCursor(options.cursor);
      if (!parsed) return ctx.refuse(400, "bad_request", "malformed cursor");
      if (parsed.order !== order) {
        return ctx.refuse(
          400,
          "bad_request",
          `cursor was issued for order "${parsed.order}" — send the same order to continue`,
        );
      }
      after = parsed;
    }
    let rows = [...table.records].sort(order === "oldest" ? oldestFirst : newestFirst);
    if (options.eq !== undefined) {
      if (!isObject(options.eq)) return ctx.refuse(400, "bad_request", "eq must be an object");
      const eq = options.eq;
      if (SUBMITTER_FILTER in eq && ctx.user() === null) {
        return ctx.refuse(400, "bad_request", `filter \`${SUBMITTER_FILTER}\` needs a signed-in caller`);
      }
      rows = rows.filter((row) =>
        Object.entries(eq).every(([column, value]) => sameValue(row[column] ?? null, value)),
      );
    }
    if (after) {
      const { ms, key } = after;
      rows = rows.filter((row) =>
        order === "oldest"
          ? row._created_at_ms > ms || (row._created_at_ms === ms && row.id > key)
          : row._created_at_ms < ms || (row._created_at_ms === ms && row.id < key),
      );
    }
    // The fake filters the whole table, so its pages are always full until
    // the last one: it hands back a cursor only when another row exists.
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = rows.length > limit && last ? recordCursor(order, last) : null;
    return ctx.ok({
      ok: true,
      records: page.map((row) => recordPayload(table, row)),
      next_cursor: nextCursor,
    });
  }

  /**
   * One page of `sorted` (already in the route's order) the way the service
   * pages `tables/list` and `apps/list`: `limit` 1..100 (default 50), and a
   * `cursor` naming the last row handed back, past which `isAfter` keeps a
   * row. `next_cursor` is set only when another row exists.
   */
  function listPage<T>(
    sorted: T[],
    body: unknown,
    cursorOf: (row: T) => string,
    isAfter: (row: T, after: { ms: number; key: string }) => boolean,
  ): { page: T[]; next_cursor: string | null } | MockReply {
    const options = isObject(body) ? body : {};
    const limit = pageLimit(options);
    if (limit === null) return ctx.refuse(400, "bad_request", "limit must be between 1 and 100");
    let rows = sorted;
    if (options.cursor !== undefined) {
      const after = parseCursor(options.cursor);
      if (!after) return ctx.refuse(400, "bad_request", "malformed cursor");
      rows = rows.filter((row) => isAfter(row, after));
    }
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return { page, next_cursor: rows.length > limit && last !== undefined ? cursorOf(last) : null };
  }

  /**
   * `records/update` past the route's shape checks, in the service's order:
   * the column checks' 400s, a missing row's 404, an `inc` out of range's
   * 400, then `version_conflict` before `condition_failed`. The conditions
   * and the change are one step; any refusal changes nothing.
   */
  function update(
    table: TableState,
    row: Row | undefined,
    body: Record<string, unknown>,
    ifVersion: number | undefined,
  ): MockReply {
    const parsed = fieldsOf(body);
    if ("refusal" in parsed) return parsed.refusal;
    const { fields } = parsed;
    const incs = columnMapOf(body, "inc");
    if ("refusal" in incs) return incs.refusal;
    const conditions = columnMapOf(body, "if");
    if ("refusal" in conditions) return conditions.refusal;
    if (Object.keys(fields).length === 0 && Object.keys(incs.map).length === 0) {
      return ctx.refuse(400, "bad_request", "fields and inc together must change at least one column");
    }

    const incTypes = new Map<string, DbColumnType>();
    for (const [column, delta] of Object.entries(incs.map)) {
      if (typeof delta !== "number" || !Number.isFinite(delta)) {
        return ctx.refuse(400, "bad_request", `inc "${column}" must be a finite number`);
      }
      if (column in fields) {
        return ctx.refuse(400, "bad_request", `column "${column}" is in both fields and inc`);
      }
      // A column the fake has not seen yet is typed from the delta, the
      // way `absorbFields` types a written value.
      const type = table.columns.find((c) => c.name === column)?.type ?? inferType(delta);
      if (type !== "integer" && type !== "real") {
        return ctx.refuse(400, "bad_request", `inc "${column}" is a ${type} column, not integer or real`);
      }
      if (type === "integer" && !Number.isInteger(delta)) {
        return ctx.refuse(400, "bad_request", `inc "${column}" must be a whole number on an integer column`);
      }
      incTypes.set(column, type);
    }

    if (!row) return ctx.notFound();

    const incremented: Record<string, number> = {};
    for (const [column, type] of incTypes) {
      const start = row[column] ?? 0;
      const next = (typeof start === "number" ? start : 0) + (incs.map[column] as number);
      if (!Number.isFinite(next) || (type === "integer" && (next >= INTEGER_LIMIT || next < -INTEGER_LIMIT))) {
        return ctx.refuse(400, "bad_request", `inc "${column}" would leave the column's range`);
      }
      incremented[column] = next;
    }

    const currentVersion = row._version ?? 1;
    if (ifVersion !== undefined && ifVersion !== currentVersion) {
      return versionConflict(currentVersion);
    }
    const holds = Object.entries(conditions.map).every(([column, value]) => sameValue(row[column] ?? null, value));
    if (!holds) return conflict("condition_failed", CONDITION_FAILED_REASON);

    absorbFields(table, fields);
    for (const [column, type] of incTypes) {
      if (!table.columns.some((c) => c.name === column)) table.columns.push({ name: column, type });
    }
    Object.assign(row, fields, incremented);
    row._version = currentVersion + 1;
    row._updated_at_ms = ctx.now();
    save();
    return ctx.ok({ ok: true, record: recordPayload(table, row) });
  }

  function handle(path: string, body: unknown): MockReply | null {
    const parts = path.split("/").filter((p) => p !== "").map(decodeURIComponent);
    if (parts[0] !== "apps") return null;
    const signedIn = ctx.user() !== null;

    if (parts.length === 2 && parts[1] === "list") {
      // A page always calls through its own app, and through an app the
      // service lists only that app's own database.
      const listed = listPage(
        Object.values(state.apps)
          .filter((app) => app.app_id === ctx.appId)
          .sort(newestAppFirst),
        body,
        (app) => `${app.created_time_stamp}:${app.app_id}`,
        (app, after) =>
          app.created_time_stamp < after.ms || (app.created_time_stamp === after.ms && app.app_id < after.key),
      );
      if (!("page" in listed)) return listed;
      return ctx.ok({ ok: true, apps: listed.page.map(appPayload), next_cursor: listed.next_cursor });
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
      const listed = listPage(
        app ? Object.values(app.tables).sort(oldestTableFirst) : [],
        body,
        (table) => `${table.created_at_ms}:${table.name}`,
        (table, after) =>
          table.created_at_ms > after.ms || (table.created_at_ms === after.ms && table.name > after.key),
      );
      if (!("page" in listed)) return listed;
      return ctx.ok({ ok: true, tables: listed.page.map(tablePayload), next_cursor: listed.next_cursor });
    }

    if (route === "tables/create") {
      if (!signedIn) return ctx.notFound();
      const input = isObject(body) ? body : {};
      if (typeof input.table !== "string" || input.table === "") {
        return ctx.refuse(400, "bad_request", "table is required");
      }
      const parsedAccess = rowAccessUpdateOf(input);
      if ("reason" in parsedAccess) return ctx.refuse(400, "bad_request", parsedAccess.reason);
      const settings: DbRowAccess = { ...DEFAULT_ROW_ACCESS, ...parsedAccess.update };
      const anonRead = input.anon_read === true;
      const columns = Array.isArray(input.columns) ? (input.columns as DbColumn[]) : [];
      const refusal = rowAccessRefusal(settings, anonRead, columns);
      if (refusal !== null) return ctx.refuse(400, "bad_request", refusal);
      const app = ensureApp(appId);
      const existing = app.tables[input.table];
      if (existing && !existing.implicit) {
        return ctx.refuse(409, "table_exists", "table already exists");
      }
      const table = ensureTable(app, input.table);
      table.implicit = false;
      table.read_group = typeof input.read_group === "string" ? input.read_group : null;
      table.write_group = typeof input.write_group === "string" ? input.write_group : null;
      table.anon_read = anonRead;
      Object.assign(table, settings);
      for (const column of columns) {
        const known = table.columns.find((c) => c.name === column.name);
        if (known) known.type = column.type;
        else table.columns.push({ name: column.name, type: column.type });
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
      const parsedAccess = rowAccessUpdateOf(input);
      if ("reason" in parsedAccess) return ctx.refuse(400, "bad_request", parsedAccess.reason);
      const table = ensureTable(ensureApp(appId), tableName);
      // An omitted row-level key keeps the table's current value; the
      // rules run on the settings the table would then hold.
      const current = rowAccessOfTable(table);
      const { update } = parsedAccess;
      if (update.audience_column !== undefined && update.audience_column !== current.audience_column) {
        return ctx.refuse(400, "bad_request", AUDIENCE_IMMUTABLE_REASON);
      }
      const settings: DbRowAccess = { ...current, ...update };
      const anonRead = input.anon_read === true;
      const refusal = rowAccessRefusal(settings, anonRead, table.columns);
      if (refusal !== null) return ctx.refuse(400, "bad_request", refusal);
      table.read_group = typeof input.read_group === "string" ? input.read_group : null;
      table.write_group = typeof input.write_group === "string" ? input.write_group : null;
      table.anon_read = anonRead;
      Object.assign(table, settings);
      save();
      return ctx.ok({ ok: true, ...accessPayload(table) });
    }

    if (tail === "notify/set") {
      if (!signedIn) return ctx.notFound();
      if (!isObject(body)) return ctx.refuse(400, "bad_request", "the body must be a JSON object");
      const parsed = newRowEmailOf(body);
      if ("reason" in parsed) return ctx.refuse(400, "bad_request", parsed.reason);
      const table = ensureTable(ensureApp(appId), tableName);
      // No email service to ask: "each" and "daily" are stored as given.
      table.new_row_email = parsed.value;
      save();
      return ctx.ok({ ok: true, ...newRowEmailPayload(table) });
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
      const shaped = bodyOf(body, ["fields", "key"]);
      if ("refusal" in shaped) return shaped.refusal;
      const key = shaped.body.key;
      if (present(key) && (typeof key !== "string" || !RECORD_KEY.test(key))) {
        return ctx.refuse(
          400,
          "bad_request",
          "key must be 1–200 characters from A-Z, a-z, 0-9 and _ - . : @ / +",
        );
      }
      const parsed = fieldsOf(shaped.body);
      if ("refusal" in parsed) return parsed.refusal;
      const table = ensureTable(ensureApp(appId), tableName);
      if (typeof key === "string") {
        // A key is unique per submitter: only their own row can collide.
        const submitter = ctx.user()?.id ?? "";
        const existing = table.records.find((r) => r._submitter_user_id === submitter && r._key === key);
        if (existing) {
          return conflict(
            "key_exists",
            `a record with this key already exists: ${existing.id} — nothing was created`,
            { id: existing.id },
          );
        }
      }
      const row = insert(table, parsed.fields, typeof key === "string" ? key : null);
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
      const shaped = bodyOf(body, ["consistent"]);
      if ("refusal" in shaped) return shaped.refusal;
      const { consistent } = shaped.body;
      if (present(consistent) && typeof consistent !== "boolean") {
        return ctx.refuse(400, "bad_request", "consistent must be a boolean");
      }
      // Every read of the fake is already consistent.
      if (!table || !row) return ctx.notFound();
      return ctx.ok({ ok: true, record: recordPayload(table, row) });
    }
    if (action === "update") {
      if (!signedIn) return ctx.notFound();
      const shaped = bodyOf(body, ["fields", "inc", "if_version", "if"]);
      if ("refusal" in shaped) return shaped.refusal;
      const version = ifVersionOf(shaped.body);
      if ("refusal" in version) return version.refusal;
      if (!table) return ctx.notFound();
      return update(table, row, shaped.body, version.ifVersion);
    }
    if (action === "delete") {
      if (!signedIn) return ctx.notFound();
      const shaped = bodyOf(body, ["if_version"]);
      if ("refusal" in shaped) return shaped.refusal;
      const version = ifVersionOf(shaped.body);
      if ("refusal" in version) return version.refusal;
      if (!table || !row) return ctx.notFound();
      const currentVersion = row._version ?? 1;
      if (version.ifVersion !== undefined && version.ifVersion !== currentVersion) {
        return versionConflict(currentVersion);
      }
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

