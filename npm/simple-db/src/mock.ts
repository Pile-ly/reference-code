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
//
// Sorts and lists answer like the service: `sorts` on `tables/create` and
// `sorts/set` with the service's 400s, every table answer showing each
// sort's state; an added sort on a table holding rows is `"building"`
// until `tables/list` is next called (the fake's stand-in for the fill-in
// worker) and refused by `records/list` until then. `records/list` reads
// in `sort` / `order` / the first sort descending (nulls first, ties by
// id; a table with no sorts in id order), holds `eq` and `where` with
// every operator per column type on the value a read returns (a column
// never written reads its `columns/add` default), refuses every shape the
// service refuses (DynamoDB's 4 KB / 300-operator expression limits
// included), answers `count: true` in parts of up to 1000 rows read, and
// binds each cursor to its table, its caller (a person, a backend app, or
// every signed-out visitor as one) whatever the read scope, the rows it
// walks (its own on a `read_scope: "own"` table — except the db's owner,
// who reads every row as on the service; the fake has no mutate group
// members), its sort and direction, and the table's sorts (any `sorts/set` voids it,
// even one that keeps the same sorts). An empty `{}` inside `and` / `or` /
// `not` is the service's 400; a top-level `{}` is no condition. A column a
// table created on first use has not seen yet is untyped in a condition:
// any operator, any value, reading `null`.
//
// File columns: `upload/start` answers a ticket whose link the fake itself
// stands behind (the package's upload sends the bytes to `MOCK_UPLOAD_PATH`
// through the mock runtime instead of the network), and a record write
// attaches a ticket with the service's rules: once, only by its caller, only
// for its own table and column, never with nothing uploaded, until an hour
// after its link expired. A file field reads `{ file_id, content_type,
// size_bytes }`; `file_urls` and the `download` route answer `blob:` links.
// Records persist, but file bytes are memory-only: after a reload a file
// field keeps its metadata and its link is gone (`download` answers the
// uniform 404 and `file_urls` adds no `url`). An app or table created on
// first use gains a `file` column from an upload started into it.

import type { MockReply, MockServiceContext, MockServiceFactory, MockSeed } from "@pilely/core";

import type {
  DbApp,
  DbColumn,
  DbColumnType,
  DbMutateScope,
  DbReadScope,
  DbRowAccess,
  DbTable,
  DbTableAccess,
  DbTableNewRowEmail,
  DbTableSort,
  NewRowEmail,
} from "./types.js";
import { compareBytes, compareSorted, operatorHolds, WHERE_OPERATORS } from "./where.js";

const MARKER = "pilely-mock-fake:simple-db";

/** The path on the simple-db mock host the package's upload sends a file's
 *  bytes to in mock mode, followed by the upload id: the fake's stand-in for
 *  the storage host's presigned `PUT`. */
export const MOCK_UPLOAD_PATH = "/mock-storage/blobs/";

/** The host of the links the fake answers. Never fetched: the bytes go
 *  through `MOCK_UPLOAD_PATH`, and reads answer `blob:` links. */
const MOCK_STORAGE_ORIGIN = "https://mock-storage.pilely.invalid";

/** An upload link is valid 5 minutes; its ticket stays usable until 1 hour
 *  after that, when the service's expiry check deletes it. */
const UPLOAD_LINK_MS = 5 * 60 * 1000;
const UPLOAD_GRACE_MS = 60 * 60 * 1000;
/** The most one `file` field holds: 2 GB as storage received it. */
const MAX_FILE_BYTES = 2_147_483_648;
/** `upload/start`'s `content_type`: 1–255 characters. */
const MAX_CONTENT_TYPE_LENGTH = 255;
const UPLOAD_NOT_USABLE_REASON =
  "the upload is not usable: unknown, already used, expired, another caller's, or started for another table or column";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
/** The most rows one `records/list` count part reads. */
const COUNT_PART_ROWS = 1000;

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

/** The row-level settings, `new_row_email` and `sorts` are optional for a
 *  persisted table that lacks them; such a table reads `DEFAULT_ROW_ACCESS`,
 *  `"off"` and creation order. */
interface TableState extends Omit<DbTable, keyof DbRowAccess | "new_row_email" | "sorts">, Partial<DbRowAccess> {
  new_row_email?: NewRowEmail;
  sorts?: DbTableSort[];
  /** Raised by every `sorts/set`; a cursor carries the one it was issued
   *  under. */
  sortsVersion?: number;
  /** Each column's `columns/add` default: what a row that never wrote the
   *  column reads. */
  defaults?: Record<string, unknown>;
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

/** A file field's attach value, `{ "upload": "<upload_id>" }`. */
function isUploadRef(value: unknown): value is { upload: string } {
  return isObject(value) && Object.keys(value).length === 1 && typeof value.upload === "string";
}

function inferType(value: unknown): DbColumnType {
  if ((typeof Blob !== "undefined" && value instanceof Blob) || isUploadRef(value)) return "file";
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

// ── Sorts ──────────────────────────────────────────────────────────────

const CREATED_AT = "_created_at_ms";
const UPDATED_AT = "_updated_at_ms";

/** The most sorts a table declares, creation order included. */
const MAX_SORTS = 3;

/** The column types a sort orders. */
const SORTABLE_TYPES: readonly DbColumnType[] = ["text", "integer", "real", "boolean"];

/** The sorts of a table created without `sorts`, and of a persisted table
 *  stored without them: creation order. */
const CREATION_ORDER: readonly DbTableSort[] = [{ by: CREATED_AT, state: "ready" }];

/** A `tables/create` or `sorts/set` list of sort names checked against the
 *  columns the table holds — or the service's 400 reason. */
function sortNamesOf(raw: unknown, columns: readonly DbColumn[]): { names: string[] } | { reason: string } {
  if (!Array.isArray(raw) || raw.some((name) => typeof name !== "string")) {
    return { reason: "sorts must be an array of 0 to 3 names" };
  }
  const names = raw as string[];
  if (names.length > MAX_SORTS) {
    return { reason: `sorts holds at most ${MAX_SORTS} entries, creation order included; got ${names.length}` };
  }
  for (const [i, name] of names.entries()) {
    if (name !== CREATED_AT && name !== UPDATED_AT) {
      const column = columns.find((c) => c.name === name);
      if (!column) {
        return { reason: `sort \`${name}\` is not a column of the table, \`${CREATED_AT}\` or \`${UPDATED_AT}\`` };
      }
      if (!SORTABLE_TYPES.includes(column.type)) {
        return {
          reason: `sort \`${name}\` is a ${column.type} column; a sort orders a text, integer, real or boolean column`,
        };
      }
    }
    if (names.slice(0, i).includes(name)) return { reason: `sort \`${name}\` is listed twice` };
  }
  return { names };
}

/** What a list reads the table in: a sort (`by`) or, on a table with no
 *  sorts, its stored order (`by: null`), and the direction. */
interface Walk {
  by: string | null;
  ascending: boolean;
}

/** The service's walk for a list body's `sort` and `order` on a table with
 *  `sorts` — or the 400 reason. */
function walkOf(sorts: readonly DbTableSort[], sort: unknown, order: unknown): Walk | { reason: string } {
  const declared = (by: string): { reason: string } | null => {
    const found = sorts.find((s) => s.by === by);
    if (!found) {
      const names = sorts.map((s) => s.by);
      return {
        reason: `\`${by}\` is not one of the table's sorts (${names.length === 0 ? "it has none" : names.join(", ")}) — declare it with sorts/set`,
      };
    }
    if (found.state !== "ready") {
      return { reason: `sort \`${by}\` is still building — retry once tables/list shows it ready` };
    }
    return null;
  };
  if (present(sort) && present(order)) return { reason: "send sort or order, not both" };
  if (present(order)) {
    if (order !== "newest" && order !== "oldest") return { reason: 'order must be "newest" or "oldest"' };
    const refused = declared(CREATED_AT);
    if (refused) return { reason: `order reads creation order: ${refused.reason}` };
    return { by: CREATED_AT, ascending: order === "oldest" };
  }
  if (present(sort)) {
    const shape = { reason: 'sort must be {"by": <a declared sort>, "dir": "asc" | "desc"}' };
    if (!isObject(sort) || Object.keys(sort).length !== 2 || typeof sort.by !== "string") return shape;
    if (sort.dir !== "asc" && sort.dir !== "desc") return shape;
    const refused = declared(sort.by);
    return refused ?? { by: sort.by, ascending: sort.dir === "asc" };
  }
  const first = sorts[0];
  if (!first) return { by: null, ascending: true };
  const refused = declared(first.by);
  return refused ?? { by: first.by, ascending: false };
}

// ── Cursors ────────────────────────────────────────────────────────────

/** The prefix of every `records/list` cursor the fake hands out. The
 *  service's are `r2.` and sealed; the fake's are not sealed, but they are
 *  just as opaque to callers, and the fake refuses every other form (the
 *  service's `r1.`, the creation-order `<ms>:<id>` of before sorts, an
 *  `r2.` the fake did not issue) as malformed, as the service does. */
const RECORD_CURSOR_PREFIX = "m2.";

/** What a `records/list` cursor binds and where it resumes: after the row
 *  holding `value` (the sorted value as a read returns it) and `id`. */
interface RecordCursor {
  /** The app and table that issued it: another table's is malformed. */
  app: string;
  table: string;
  /** The caller it was issued to (`callerOf`), whatever the read scope. */
  caller: string;
  /** Whether it walks the caller's own rows (`read_scope: "own"`). */
  own: boolean;
  by: string | null;
  ascending: boolean;
  /** The table's `sortsVersion` when it was issued. */
  sorts: number;
  value: unknown;
  id: string;
}

/** The walk a `records/list` call makes, as a cursor binds it. */
interface CursorWalk extends Walk {
  app: string;
  table: string;
  caller: string;
  own: boolean;
  sorts: number;
}

/** The caller a cursor is bound to: a person by user id, a backend app by
 *  app id, and every signed-out visitor one caller. */
function callerOf(user: { id: string | null; app: string | null } | null): string {
  if (!user) return "anon";
  if (user.id) return `person:${user.id}`;
  return `app:${user.app ?? ""}`;
}

/** Whether a `records/list` caller walks only their own rows, as the
 *  service's list access check decides it: only on a `read_scope: "own"`
 *  table, and never for the db's owner (a person whose handle is the app's
 *  `owner_handle`), who reads every row. The service also gives every row
 *  to a member of the table's `mutate_group`; the fake has no group
 *  lookups, so nobody else is a member — every other signed-in person and
 *  the app's backend walk their own rows. A signed-out visitor never
 *  reaches an `"own"` table (it cannot carry `anon_read`). */
function walksOwnRows(
  app: { owner_handle: string } | undefined,
  table: TableState,
  user: { id: string | null; handle: string | null } | null,
): boolean {
  if (user === null || rowAccessOfTable(table).read_scope !== "own") return false;
  const isOwner = user.id !== null && user.handle !== null && user.handle === app?.owner_handle;
  return !isOwner;
}

const RESTART = "start again without a cursor";

function encodeRecordCursor(cursor: RecordCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${RECORD_CURSOR_PREFIX}${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

/** A cursor the fake issued, decoded — or `null`. */
function decodeRecordCursor(raw: unknown): RecordCursor | null {
  if (typeof raw !== "string" || !raw.startsWith(RECORD_CURSOR_PREFIX)) return null;
  try {
    const base64 = raw.slice(RECORD_CURSOR_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0))));
    if (
      isObject(parsed) &&
      typeof parsed.app === "string" &&
      typeof parsed.table === "string" &&
      typeof parsed.caller === "string" &&
      typeof parsed.own === "boolean" &&
      typeof parsed.id === "string" &&
      typeof parsed.ascending === "boolean" &&
      typeof parsed.sorts === "number" &&
      (parsed.by === null || typeof parsed.by === "string") &&
      "value" in parsed
    ) {
      return parsed as unknown as RecordCursor;
    }
  } catch {
    // Falls through to malformed.
  }
  return null;
}

/** A `records/list` cursor, checked against the walk it is sent with in
 *  the service's order — or the 400 reason. */
function recordCursorFor(raw: unknown, walk: CursorWalk): RecordCursor | { reason: string } {
  const cursor = decodeRecordCursor(raw);
  if (!cursor || cursor.app !== walk.app || cursor.table !== walk.table) {
    return { reason: `malformed cursor — ${RESTART}` };
  }
  if (cursor.caller !== walk.caller) return { reason: `cursor was issued to another caller — ${RESTART}` };
  if (cursor.own !== walk.own) return { reason: `cursor was issued under another read scope — ${RESTART}` };
  if (cursor.by !== walk.by || cursor.ascending !== walk.ascending) {
    const issued = cursor.by === null ? "the table's stored order" : `sort \`${cursor.by}\``;
    return {
      reason: `cursor was issued for ${issued} ${cursor.ascending ? "asc" : "desc"} — send the same sort and direction to continue`,
    };
  }
  if (cursor.sorts !== walk.sorts) {
    return { reason: `the table's sorts changed since this cursor was issued — ${RESTART}` };
  }
  return cursor;
}

// ── Conditions ─────────────────────────────────────────────────────────

/** The most `in` values, and DynamoDB's expression limits a list's whole
 *  condition (`where` and `eq` together) must fit. */
const MAX_IN_VALUES = 100;
const MAX_FILTER_BYTES = 4096;
const MAX_FILTER_OPERATORS = 300;

/** The operators each column type takes. */
const OPERATORS_BY_TYPE: Record<DbColumnType, readonly string[]> = {
  text: WHERE_OPERATORS,
  integer: ["eq", "ne", "lt", "lte", "gt", "gte", "between", "in", "is_null"],
  real: ["eq", "ne", "lt", "lte", "gt", "gte", "between", "in", "is_null"],
  boolean: ["eq", "ne", "in", "is_null"],
  json: ["eq", "is_null"],
  file: ["is_null"],
};

/** One field a condition reads. `type` is `null` for a column a table
 *  created on first use has not seen yet: it takes any operator and value
 *  and reads `null`. */
interface ConditionField {
  name: string;
  type: DbColumnType | null;
  /** What a row that never wrote the column reads. */
  default: unknown;
  /** A reserved field every row holds. */
  alwaysPresent: boolean;
}

type Condition =
  | { kind: "all"; parts: Condition[] }
  | { kind: "any"; parts: Condition[] }
  | { kind: "not"; inner: Condition }
  | { kind: "leaf"; field: ConditionField; op: string; operand: unknown };

/** Whether `value` has `type`'s JSON shape; any non-null value for an
 *  unseen column. */
function fitsType(type: DbColumnType | null, value: unknown): boolean {
  switch (type) {
    case "text":
      return typeof value === "string";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "real":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "file":
      return false;
    default:
      return value !== null && value !== undefined;
  }
}

/** A JSON object's keys in the order the service reads them (sorted). */
function sortedEntries(object: Record<string, unknown>): [string, unknown][] {
  return Object.entries(object).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** One operator of `field` with its operand — or the 400 reason. */
function conditionLeaf(field: ConditionField, op: string, operand: unknown): Condition | { reason: string } {
  const allowed = field.type === null ? WHERE_OPERATORS : OPERATORS_BY_TYPE[field.type];
  if (!allowed.includes(op)) {
    return {
      reason: (WHERE_OPERATORS as readonly string[]).includes(op)
        ? `where \`${field.name}\`: a ${field.type ?? "column"} field takes ${allowed.join(", ")} — not \`${op}\``
        : `where \`${field.name}\`: unknown operator \`${op}\``,
    };
  }
  const value = (v: unknown): { reason: string } | null => {
    if (v === null || v === undefined) {
      return { reason: `where \`${field.name}\`: ${op} takes a value, not null — use is_null` };
    }
    if (!fitsType(field.type, v)) {
      return { reason: `where \`${field.name}\`: ${op} takes a ${field.type ?? "non-null"} value` };
    }
    return null;
  };
  const leaf: Condition = { kind: "leaf", field, op, operand };
  switch (op) {
    case "between": {
      if (!Array.isArray(operand) || operand.length !== 2) {
        return { reason: `where \`${field.name}\`: between takes [low, high]` };
      }
      const refused = value(operand[0]) ?? value(operand[1]);
      if (refused) return refused;
      const [low, high] = operand as [unknown, unknown];
      const above =
        typeof low === "number" && typeof high === "number"
          ? low > high
          : typeof low === "string" && typeof high === "string" && compareBytes(low, high) > 0;
      if (above) {
        return { reason: `where \`${field.name}\`: between's low is above its high` };
      }
      return leaf;
    }
    case "in": {
      if (!Array.isArray(operand)) return { reason: `where \`${field.name}\`: in takes an array of values` };
      if (operand.length === 0 || operand.length > MAX_IN_VALUES) {
        return { reason: `where \`${field.name}\`: in takes 1 to ${MAX_IN_VALUES} values` };
      }
      for (const v of operand) {
        const refused = value(v);
        if (refused) return refused;
      }
      return leaf;
    }
    case "begins_with":
    case "contains":
      return typeof operand === "string" ? leaf : { reason: `where \`${field.name}\`: ${op} takes a string` };
    case "is_null":
      return typeof operand === "boolean" ? leaf : { reason: `where \`${field.name}\`: is_null takes true or false` };
    default:
      return value(operand) ?? leaf;
  }
}

/** A `where` object parsed against the fields `resolve` names — or the
 *  service's 400 reason. `nested` inside `and` / `or` / `not`, where an
 *  empty `{}` names nothing and is refused; a top-level `{}` is no
 *  condition. */
function parseCondition(
  raw: unknown,
  resolve: (name: string) => ConditionField | { reason: string },
  nested = false,
): Condition | { reason: string } {
  if (!isObject(raw)) return { reason: "where must be an object" };
  if (nested && Object.keys(raw).length === 0) {
    return { reason: "where: an empty condition {} inside and / or / not names nothing — remove it" };
  }
  const parts: Condition[] = [];
  for (const [key, value] of sortedEntries(raw)) {
    if (key === "and" || key === "or") {
      if (!Array.isArray(value)) return { reason: `where \`${key}\` must be an array of conditions` };
      if (value.length === 0) return { reason: `where \`${key}\` must not be empty` };
      const inner: Condition[] = [];
      for (const item of value) {
        const parsed = parseCondition(item, resolve, true);
        if ("reason" in parsed) return parsed;
        inner.push(parsed);
      }
      parts.push({ kind: key === "and" ? "all" : "any", parts: inner });
    } else if (key === "not") {
      const inner = parseCondition(value, resolve, true);
      if ("reason" in inner) return inner;
      parts.push({ kind: "not", inner });
    } else {
      const field = resolve(key);
      if ("reason" in field) return field;
      const ops = isObject(value) ? value : { eq: value };
      if (Object.keys(ops).length === 0) return { reason: `where \`${key}\` names no operator` };
      for (const [op, operand] of sortedEntries(ops)) {
        const leaf = conditionLeaf(field, op, operand);
        if ("reason" in leaf) return leaf;
        parts.push(leaf);
      }
    }
  }
  return parts.length === 1 && parts[0] ? parts[0] : { kind: "all", parts };
}

/** Whether `condition` holds on a row whose fields `read` answers. */
function conditionHolds(condition: Condition, read: (field: string) => unknown): boolean {
  switch (condition.kind) {
    case "all":
      return condition.parts.every((part) => conditionHolds(part, read));
    case "any":
      return condition.parts.some((part) => conditionHolds(part, read));
    case "not":
      return !conditionHolds(condition.inner, read);
    default:
      return operatorHolds(condition.op, condition.operand, read(condition.field.name));
  }
}

/** The `#nN` / `:vN` placeholders of one rendered expression. */
class Placeholders {
  private names = new Map<string, string>();
  private values = 0;
  name(field: string): string {
    let alias = this.names.get(field);
    if (!alias) {
      alias = `#n${this.names.size}`;
      this.names.set(field, alias);
    }
    return alias;
  }
  value(): string {
    const alias = `:v${this.values}`;
    this.values += 1;
    return alias;
  }
}

/** One condition as the service renders it into DynamoDB's filter
 *  expression, and its operator count: each leaf total over a value, an
 *  explicit null and an absent attribute. */
function renderCondition(condition: Condition, ph: Placeholders): { expr: string; ops: number } {
  if (condition.kind === "all" || condition.kind === "any") {
    const rendered = condition.parts.map((part) => renderCondition(part, ph));
    const ops = Math.max(rendered.length - 1, 0) + rendered.reduce((sum, r) => sum + r.ops, 0);
    if (rendered.length === 0) return { expr: "", ops: 0 };
    if (rendered.length === 1) return { expr: rendered[0]?.expr ?? "", ops };
    return { expr: `(${rendered.map((r) => r.expr).join(condition.kind === "all" ? " AND " : " OR ")})`, ops };
  }
  if (condition.kind === "not") {
    const inner = renderCondition(condition.inner, ph);
    return { expr: `(NOT ${inner.expr})`, ops: inner.ops + 1 };
  }
  const { field, op, operand } = condition;
  const defaultIsNull = field.default === null || field.default === undefined;
  if (op === "ne") {
    const eq = renderCondition({ ...condition, op: "eq" }, ph);
    return { expr: `(NOT ${eq.expr})`, ops: eq.ops + 1 };
  }
  if (op === "is_null") {
    const name = ph.name(field.name);
    let expr = `attribute_type(${name}, ${ph.value()})`;
    let ops = 1;
    if (!field.alwaysPresent && defaultIsNull) {
      expr = `(${expr} OR attribute_not_exists(${name}))`;
      ops += 2;
    }
    return operand === true ? { expr, ops } : { expr: `(NOT ${expr})`, ops: ops + 1 };
  }
  const name = ph.name(field.name);
  let predicate: string;
  let ops = 1;
  switch (op) {
    case "between":
      predicate = `${name} BETWEEN ${ph.value()} AND ${ph.value()}`;
      ops = 2;
      break;
    case "in":
      predicate = `${name} IN (${(operand as unknown[]).map(() => ph.value()).join(", ")})`;
      break;
    case "begins_with":
    case "contains":
      predicate = `${op}(${name}, ${ph.value()})`;
      break;
    default: {
      const symbol = { eq: "=", lt: "<", lte: "<=", gt: ">", gte: ">=" }[op] ?? "=";
      predicate = `${name} ${symbol} ${ph.value()}`;
    }
  }
  if (!field.alwaysPresent && !defaultIsNull && operatorHolds(op, operand, field.default)) {
    return { expr: `(${predicate} OR attribute_not_exists(${name}))`, ops: ops + 2 };
  }
  return { expr: predicate, ops };
}

/** The service's 400 reason when a list's conditions (`eq` leaves, then
 *  `where`) render past DynamoDB's 4 KB or 300 operators; `null` when they
 *  fit. */
function conditionLimitRefusal(conditions: readonly Condition[]): string | null {
  const ph = new Placeholders();
  const clauses: string[] = [];
  let operators = 0;
  for (const condition of conditions) {
    const { expr, ops } = renderCondition(condition, ph);
    if (expr !== "") {
      clauses.push(expr);
      operators += ops;
    }
  }
  operators += Math.max(clauses.length - 1, 0);
  const bytes = new TextEncoder().encode(clauses.join(" AND ")).length;
  if (bytes > MAX_FILTER_BYTES) {
    return `the list's condition (where, eq and access) renders to ${bytes} bytes; DynamoDB takes at most ${MAX_FILTER_BYTES}`;
  }
  if (operators > MAX_FILTER_OPERATORS) {
    return `the list's condition (where, eq and access) uses ${operators} operators; DynamoDB takes at most ${MAX_FILTER_OPERATORS}`;
  }
  return null;
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
    sorts: sortsOfTable(table),
    created_at_ms: table.created_at_ms,
    columns: table.columns.map((c) => ({ name: c.name, type: c.type })),
  };
}

/** The table's sorts, creation order when it never set them. */
function sortsOfTable(table: TableState): DbTableSort[] {
  return (table.sorts ?? CREATION_ORDER).map((sort) => ({ by: sort.by, state: sort.state }));
}

/** Field `name` of `row` as a read returns it: a column never written
 *  reads its default, or `null`. */
function readField(table: TableState, row: Row, name: string): unknown {
  switch (name) {
    case "_version":
      return row._version ?? 1;
    case "_key":
      return row._key ?? null;
    default:
      if (name in row) return row[name] ?? null;
      return table.defaults?.[name] ?? null;
  }
}

/** The value a sort by `by` orders `row` by: the field as a read returns
 *  it, `null` when it does not have the sort's type. */
function sortValue(table: TableState, row: Row, by: string): unknown {
  const value = readField(table, row, by);
  const type = by === CREATED_AT || by === UPDATED_AT ? "integer" : table.columns.find((c) => c.name === by)?.type;
  switch (type) {
    case "text":
      return typeof value === "string" ? value : null;
    case "integer":
    case "real":
      return typeof value === "number" ? value : null;
    case "boolean":
      return typeof value === "boolean" ? value : null;
    default:
      return null;
  }
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

/** A stored file field: what every read answers for it. */
interface StoredFile {
  file_id: string;
  content_type: string;
  size_bytes: number;
}

function isStoredFile(value: unknown): value is StoredFile {
  return isObject(value) && typeof value.file_id === "string";
}

/** Whether `column` is a declared `file` column of `table`. */
function fileColumn(table: TableState, column: string): boolean {
  return table.columns.some((c) => c.name === column && c.type === "file");
}

/** The record as the service renders it: `id`, every column in registry
 *  order (`null` when absent), then the reserved stamps. `urlOf` adds a
 *  download `url` to a file field, when the read asked for `file_urls`. */
function recordPayload(
  table: TableState,
  row: Row,
  urlOf?: (file: StoredFile) => string | null,
): Record<string, unknown> {
  const out: Record<string, unknown> = { id: row.id };
  for (const column of table.columns) {
    const value = readField(table, row, column.name);
    if (column.type === "file" && isStoredFile(value)) {
      const file = { file_id: value.file_id, content_type: value.content_type, size_bytes: value.size_bytes };
      const url = urlOf ? urlOf(file) : null;
      out[column.name] = url === null ? file : { ...file, url };
    } else {
      out[column.name] = value;
    }
  }
  out._submitter_user_id = row._submitter_user_id;
  out._submitter_handle = row._submitter_handle;
  out._created_at_ms = row._created_at_ms;
  out._updated_at_ms = row._updated_at_ms;
  out._version = row._version ?? 1;
  out._key = row._key ?? null;
  return out;
}

/** One `upload/start` ticket, held in memory. */
interface PendingUpload {
  appId: string;
  table: string;
  column: string;
  userId: string;
  contentType: string;
  expiresAt: number;
  bytes: Blob | null;
  attached: boolean;
}

/** A record write's file fields, checked: the fields to store, and the step
 *  that consumes their tickets once the write is going ahead. */
interface Attach {
  fields: Record<string, unknown>;
  /** Given the row an update changes, its replaced files are dropped. */
  commit(replacing?: Row): void;
}

export const createSimpleDbFake: MockServiceFactory = (ctx: MockServiceContext) => {
  const state: DbState = ctx.load<DbState>() ?? { apps: {} };
  const save = () => ctx.save(state);
  const uploads = new Map<string, PendingUpload>();
  const fileBytes = new Map<string, Blob>();
  const fileUrls = new Map<string, string>();

  /** A `blob:` link to a file's bytes, minted once per file; `null` when
   *  the bytes are gone (they do not survive a reload). */
  function fileUrl(file: StoredFile): string | null {
    const bytes = fileBytes.get(file.file_id);
    if (!bytes) return null;
    let url = fileUrls.get(file.file_id);
    if (!url) {
      url =
        typeof URL.createObjectURL === "function"
          ? URL.createObjectURL(bytes)
          : `${MOCK_STORAGE_ORIGIN}/blobs/${file.file_id}`;
      fileUrls.set(file.file_id, url);
    }
    return url;
  }

  /** Drops a removed file's bytes and link. */
  function dropFile(value: unknown): void {
    if (!isStoredFile(value)) return;
    fileBytes.delete(value.file_id);
    const url = fileUrls.get(value.file_id);
    if (url && url.startsWith("blob:")) URL.revokeObjectURL(url);
    fileUrls.delete(value.file_id);
  }

  /** Drops every file `row` holds in a `file` column. */
  function dropRowFiles(table: TableState, row: Row): void {
    for (const column of table.columns) {
      if (column.type === "file") dropFile(row[column.name]);
    }
  }

  /** Whether `upload` can still be attached at `now`. */
  function usable(upload: PendingUpload): boolean {
    return !upload.attached && ctx.now() < upload.expiresAt + UPLOAD_GRACE_MS;
  }

  /**
   * Checks the file fields of a record write on `table`, changing nothing:
   * a declared `file` column (or, on first use, a column the write gives an
   * `{ upload }`) takes `null` or a usable ticket of the caller's with bytes
   * behind it. `commit` attaches the tickets, types new columns `file` and,
   * given the row an update replaces them in, drops the files it held.
   */
  function attach(appId: string, table: TableState, fields: Record<string, unknown>): Attach | { refusal: MockReply } {
    const userId = ctx.user()?.id ?? "";
    const resolved: Record<string, unknown> = { ...fields };
    const tickets: [string, PendingUpload][] = [];
    const fileColumns: string[] = [];
    for (const [name, value] of Object.entries(fields)) {
      const declared = table.columns.find((c) => c.name === name);
      const isFile = declared ? declared.type === "file" : isUploadRef(value);
      if (!isFile) continue;
      fileColumns.push(name);
      if (value === null) continue;
      if (!isUploadRef(value)) {
        return {
          refusal: ctx.refuse(400, "bad_request", `file column "${name}" takes {"upload": "<upload_id>"} or null`),
        };
      }
      const upload = uploads.get(value.upload);
      if (
        !upload ||
        !usable(upload) ||
        upload.userId !== userId ||
        upload.appId !== appId ||
        upload.table !== table.name ||
        upload.column !== name ||
        tickets.some(([, taken]) => taken === upload)
      ) {
        return { refusal: ctx.refuse(400, "bad_request", UPLOAD_NOT_USABLE_REASON) };
      }
      if (!upload.bytes) {
        return { refusal: ctx.refuse(400, "bad_request", "nothing was uploaded to this upload's link") };
      }
      if (upload.bytes.size > MAX_FILE_BYTES) {
        return { refusal: ctx.refuse(413, "file_too_large", "the uploaded file is over 2 GB") };
      }
      const fileId = ctx.nanoid(22);
      resolved[name] = { file_id: fileId, content_type: upload.contentType, size_bytes: upload.bytes.size };
      tickets.push([fileId, upload]);
    }
    return {
      fields: resolved,
      commit: (replacing?: Row) => {
        for (const name of fileColumns) {
          if (!table.columns.some((c) => c.name === name)) table.columns.push({ name, type: "file" });
          if (replacing) dropFile(replacing[name]);
        }
        for (const [fileId, upload] of tickets) {
          upload.attached = true;
          if (upload.bytes) fileBytes.set(fileId, upload.bytes);
          upload.bytes = null;
        }
      },
    };
  }

  /** `upload/start` on `tableName` / `column`: a ticket and its link. */
  function startUpload(appId: string, tableName: string, column: string, body: unknown): MockReply {
    const shaped = bodyOf(body, ["content_type"]);
    if ("refusal" in shaped) return shaped.refusal;
    const contentType = shaped.body.content_type;
    if (
      typeof contentType !== "string" ||
      contentType.trim() === "" ||
      contentType.length > MAX_CONTENT_TYPE_LENGTH ||
      contentType.trim() !== contentType ||
      !/^[\x20-\x7e]+$/.test(contentType)
    ) {
      return ctx.refuse(400, "bad_request", "content_type must be 1–255 visible ASCII characters");
    }
    const table = ensureTable(ensureApp(appId), tableName);
    const declared = table.columns.find((c) => c.name === column);
    if (declared && declared.type !== "file") {
      return ctx.refuse(400, "bad_request", `column "${column}" is not a file column`);
    }
    if (!declared) {
      // First use: the column the upload is for becomes a file column.
      table.columns.push({ name: column, type: "file" });
    }
    save();
    const uploadId = ctx.nanoid(22);
    const expiresAt = ctx.now() + UPLOAD_LINK_MS;
    uploads.set(uploadId, {
      appId,
      table: tableName,
      column,
      userId: ctx.user()?.id ?? "",
      contentType,
      expiresAt,
      bytes: null,
      attached: false,
    });
    return ctx.ok({
      ok: true,
      upload_id: uploadId,
      upload_url: `${MOCK_STORAGE_ORIGIN}/blobs/${uploadId}`,
      expires_at: expiresAt,
    });
  }

  /** The bytes of a ticket's `PUT`: refused, as the storage host refuses a
   *  link, once the link expired or with another `Content-Type`. */
  function receiveUpload(uploadId: string, form: FormData | null): MockReply {
    const upload = uploads.get(uploadId);
    const file = form?.get("file");
    const contentType = form?.get("content_type");
    if (!upload || upload.attached || ctx.now() >= upload.expiresAt || !(file instanceof Blob)) {
      return ctx.refuse(403, "upload_failed", "the upload link is unknown or has expired");
    }
    if (contentType !== upload.contentType) {
      return ctx.refuse(403, "upload_failed", "the upload's Content-Type is not the one upload/start signed");
    }
    upload.bytes = file;
    return ctx.ok({ ok: true });
  }

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

  /** The field `name` names in a condition on `table` — or the service's
   *  400 reason. A table created on first use takes a column it has not
   *  seen yet as an untyped one that reads `null`. */
  function conditionField(table: TableState, name: string, filter: "where" | "eq"): ConditionField | { reason: string } {
    if (filter === "where" && (name === CREATED_AT || name === UPDATED_AT)) {
      return { name, type: "integer", default: null, alwaysPresent: true };
    }
    if (name === SUBMITTER_FILTER) {
      if (ctx.user() === null) return { reason: `${filter} \`${SUBMITTER_FILTER}\` needs a signed-in caller` };
      return { name, type: "text", default: null, alwaysPresent: true };
    }
    const column = table.columns.find((c) => c.name === name);
    if (column) {
      return { name, type: column.type, default: table.defaults?.[name] ?? null, alwaysPresent: false };
    }
    if (table.implicit && !name.startsWith("_") && !RESERVED.has(name)) {
      return { name, type: null, default: null, alwaysPresent: false };
    }
    return { reason: filter === "where" ? `unknown where field \`${name}\`` : `unknown filter column \`${name}\`` };
  }

  /** `eq` as conditions, each checked like the service's — or its 400
   *  reason. */
  function eqConditions(table: TableState, eq: unknown): Condition[] | { reason: string } {
    if (!isObject(eq)) return { reason: "eq must be an object" };
    const conditions: Condition[] = [];
    for (const [name, value] of sortedEntries(eq)) {
      const field = conditionField(table, name, "eq");
      if ("reason" in field) return field;
      if (field.type === "file") return { reason: `filter \`${name}\`: a file column cannot be an eq filter` };
      if (value === null) return { reason: `filter \`${name}\` must not be null` };
      if (!fitsType(field.type, value)) return { reason: `filter \`${name}\`: expected a ${field.type} value` };
      conditions.push({ kind: "leaf", field, op: "eq", operand: value });
    }
    return conditions;
  }

  /**
   * `records/list` the way the service answers it: the walk (`sort`, `order`
   * or the table's first sort descending; a table with no sorts in id
   * order), a cursor bound to that table and walk, its caller, the read
   * scope and the table's sorts, `eq` and `where` checked and held as a read returns
   * each value, and either a page of rows or (`count: true`) a count part.
   * The fake reads the whole table at once, so a page is full until the
   * last one, and a count part covers up to `COUNT_PART_ROWS` rows.
   */
  function listRecords(appId: string, table: TableState, body: unknown): MockReply {
    const options = isObject(body) ? body : {};
    const refuse = (reason: string) => ctx.refuse(400, "bad_request", reason);
    if (present(options.file_urls) && typeof options.file_urls !== "boolean") {
      return refuse("file_urls must be a boolean");
    }
    if (present(options.count) && typeof options.count !== "boolean") return refuse("count must be a boolean");
    const counting = options.count === true;
    const limit = counting ? MAX_PAGE_SIZE : pageLimit(options);
    if (limit === null) return refuse("limit must be between 1 and 100");
    const walk = walkOf(sortsOfTable(table), options.sort, options.order);
    if ("reason" in walk) return refuse(walk.reason);
    const user = ctx.user();
    const bound: CursorWalk = {
      ...walk,
      app: appId,
      table: table.name,
      caller: callerOf(user),
      own: walksOwnRows(state.apps[appId], table, user),
      sorts: table.sortsVersion ?? 0,
    };
    let after: RecordCursor | null = null;
    if (present(options.cursor)) {
      const cursor = recordCursorFor(options.cursor, bound);
      if ("reason" in cursor) return refuse(cursor.reason);
      after = cursor;
    }
    const conditions: Condition[] = [];
    if (options.eq !== undefined) {
      const eq = eqConditions(table, options.eq);
      if ("reason" in eq) return refuse(eq.reason);
      conditions.push(...eq);
    }
    if (present(options.where)) {
      const where = parseCondition(options.where, (name) => conditionField(table, name, "where"));
      if ("reason" in where) return refuse(where.reason);
      conditions.push(where);
    }
    const tooBig = conditionLimitRefusal(conditions);
    if (tooBig !== null) return refuse(tooBig);

    const { by, ascending } = walk;
    const valueOf = (row: Row): unknown => (by === null ? null : sortValue(table, row, by));
    const direction = ascending ? 1 : -1;
    let rows = [...table.records].sort((a, b) => direction * compareSorted(valueOf(a), a.id, valueOf(b), b.id));
    if (after) {
      const { value, id } = after;
      rows = rows.filter((row) => direction * compareSorted(valueOf(row), row.id, value, id) > 0);
    }
    const holds = (row: Row) =>
      conditions.every((condition) => conditionHolds(condition, (name) => readField(table, row, name)));
    const cursorAfter = (row: Row): string =>
      encodeRecordCursor({
        app: bound.app,
        table: bound.table,
        caller: bound.caller,
        own: bound.own,
        by,
        ascending,
        sorts: bound.sorts,
        value: valueOf(row),
        id: row.id,
      });

    if (counting) {
      const read = rows.slice(0, COUNT_PART_ROWS);
      const last = read[read.length - 1];
      return ctx.ok({
        ok: true,
        count: read.filter(holds).length,
        next_cursor: rows.length > COUNT_PART_ROWS && last ? cursorAfter(last) : null,
      });
    }
    const withUrls = options.file_urls === true;
    const matched = rows.filter(holds);
    const page = matched.slice(0, limit);
    const last = page[page.length - 1];
    return ctx.ok({
      ok: true,
      records: page.map((row) => recordPayload(table, row, withUrls ? fileUrl : undefined)),
      next_cursor: matched.length > limit && last ? cursorAfter(last) : null,
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
    appId: string,
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
    const fileCondition = Object.keys(conditions.map).find((column) => fileColumn(table, column));
    if (fileCondition !== undefined) {
      return ctx.refuse(400, "bad_request", `file column "${fileCondition}" cannot be an if condition`);
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

    const attached = attach(appId, table, fields);
    if ("refusal" in attached) return attached.refusal;

    const incremented: Record<string, number> = {};
    for (const [column, type] of incTypes) {
      const start = readField(table, row, column) ?? 0;
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
    const holds = Object.entries(conditions.map).every(([column, value]) =>
      sameValue(readField(table, row, column), value),
    );
    if (!holds) return conflict("condition_failed", CONDITION_FAILED_REASON);

    attached.commit(row);
    absorbFields(table, attached.fields);
    for (const [column, type] of incTypes) {
      if (!table.columns.some((c) => c.name === column)) table.columns.push({ name: column, type });
    }
    Object.assign(row, attached.fields, incremented);
    row._version = currentVersion + 1;
    row._updated_at_ms = ctx.now();
    save();
    return ctx.ok({ ok: true, record: recordPayload(table, row) });
  }

  function handle(path: string, body: unknown, form: FormData | null): MockReply | null {
    if (path.startsWith(MOCK_UPLOAD_PATH)) {
      return receiveUpload(decodeURIComponent(path.slice(MOCK_UPLOAD_PATH.length)), form);
    }
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
      const app = state.apps[appId];
      if (!app) return ctx.notFound();
      for (const table of Object.values(app.tables)) {
        for (const row of table.records) dropRowFiles(table, row);
      }
      delete state.apps[appId];
      save();
      return ctx.ok({ ok: true, app_id: appId });
    }

    if (route === "tables/list") {
      const app = state.apps[appId];
      // No worker fills a building sort in: the fake finishes it here, so
      // the poll the service's manual asks for sees it ready.
      let filled = false;
      for (const table of Object.values(app?.tables ?? {})) {
        for (const sort of table.sorts ?? []) {
          if (sort.state === "building") {
            sort.state = "ready";
            filled = true;
          }
        }
      }
      if (filled) save();
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
      let sorts: string[] = CREATION_ORDER.map((sort) => sort.by);
      if (present(input.sorts)) {
        const parsedSorts = sortNamesOf(input.sorts, columns);
        if ("reason" in parsedSorts) return ctx.refuse(400, "bad_request", parsedSorts.reason);
        sorts = parsedSorts.names;
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
      table.anon_read = anonRead;
      Object.assign(table, settings);
      table.sorts = sorts.map((by) => ({ by, state: "ready" }));
      table.sortsVersion = (table.sortsVersion ?? 0) + 1;
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

    if (tail === "sorts/set") {
      if (!signedIn) return ctx.notFound();
      if (!isObject(body)) return ctx.refuse(400, "bad_request", "the body must be a JSON object");
      if (!present(body.sorts)) {
        return ctx.refuse(400, "bad_request", "sorts is required: the table's whole new list of sorts, [] for none");
      }
      const table = ensureTable(ensureApp(appId), tableName);
      const parsed = sortNamesOf(body.sorts, table.columns);
      if ("reason" in parsed) return ctx.refuse(400, "bad_request", parsed.reason);
      // A kept sort keeps its state; an added one is building while the
      // table holds rows (until tables/list is next called), else ready.
      const current = sortsOfTable(table);
      const hasRows = table.records.length > 0;
      table.sorts = parsed.names.map((by) => ({
        by,
        state: current.find((sort) => sort.by === by)?.state ?? (hasRows ? "building" : "ready"),
      }));
      table.sortsVersion = (table.sortsVersion ?? 0) + 1;
      save();
      return ctx.ok({ ok: true, table: tablePayload(table) });
    }

    if (tail === "columns/add") {
      if (!signedIn) return ctx.notFound();
      const input = isObject(body) ? body : {};
      if (typeof input.name !== "string" || typeof input.type !== "string") {
        return ctx.refuse(400, "bad_request", "name and type are required");
      }
      if (input.type === "file" && present(input.default)) {
        return ctx.refuse(400, "bad_request", "a file column has no default");
      }
      const table = ensureTable(ensureApp(appId), tableName);
      if (table.columns.some((c) => c.name === input.name)) {
        return ctx.refuse(409, "column_exists", "column already exists");
      }
      table.columns.push({ name: input.name, type: input.type as DbColumnType });
      if (present(input.default)) {
        // Every row that never wrote the column, existing or future, reads it.
        table.defaults = { ...table.defaults, [input.name]: input.default };
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
      const attached = attach(appId, table, parsed.fields);
      if ("refusal" in attached) return attached.refusal;
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
      attached.commit();
      const row = insert(table, attached.fields, typeof key === "string" ? key : null);
      save();
      return ctx.ok({ ok: true, record: recordPayload(table, row) });
    }

    if (tail === "records/list") {
      const table = ensureTable(ensureApp(appId), tableName);
      return listRecords(appId, table, body);
    }

    const upload = /^files\/([^/]+)\/upload\/start$/.exec(tail);
    if (upload) {
      if (!signedIn) return ctx.notFound();
      return startUpload(appId, tableName, upload[1] ?? "", body);
    }

    if (rest[2] === "records" && rest[4] === "files" && rest[6] === "download" && rest.length === 7) {
      const recordId = rest[3] ?? "";
      const column = rest[5] ?? "";
      const shaped = bodyOf(body, []);
      if ("refusal" in shaped) return shaped.refusal;
      const table = state.apps[appId]?.tables[tableName];
      if (table && !fileColumn(table, column)) {
        return ctx.refuse(400, "bad_request", `column "${column}" is not a file column`);
      }
      const value = table?.records.find((r) => r.id === recordId)?.[column];
      const url = isStoredFile(value) ? fileUrl(value) : null;
      if (!isStoredFile(value) || url === null) return ctx.notFound();
      return ctx.ok({ ok: true, url, content_type: value.content_type, size_bytes: value.size_bytes });
    }

    if (rest[2] !== "records" || rest[3] === undefined || rest.length !== 5) return null;
    const recordId = rest[3];
    const action = rest[4];
    const table = state.apps[appId]?.tables[tableName];
    const row = table?.records.find((r) => r.id === recordId);

    if (action === "get") {
      const shaped = bodyOf(body, ["consistent", "file_urls"]);
      if ("refusal" in shaped) return shaped.refusal;
      const { consistent, file_urls: withUrls } = shaped.body;
      if (present(consistent) && typeof consistent !== "boolean") {
        return ctx.refuse(400, "bad_request", "consistent must be a boolean");
      }
      if (present(withUrls) && typeof withUrls !== "boolean") {
        return ctx.refuse(400, "bad_request", "file_urls must be a boolean");
      }
      // Every read of the fake is already consistent.
      if (!table || !row) return ctx.notFound();
      return ctx.ok({ ok: true, record: recordPayload(table, row, withUrls === true ? fileUrl : undefined) });
    }
    if (action === "update") {
      if (!signedIn) return ctx.notFound();
      const shaped = bodyOf(body, ["fields", "inc", "if_version", "if"]);
      if ("refusal" in shaped) return shaped.refusal;
      const version = ifVersionOf(shaped.body);
      if ("refusal" in version) return version.refusal;
      if (!table) return ctx.notFound();
      return update(appId, table, row, shaped.body, version.ifVersion);
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
      dropRowFiles(table, row);
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

  function dispose(): void {
    for (const url of fileUrls.values()) {
      if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    }
    fileUrls.clear();
    fileBytes.clear();
    uploads.clear();
  }

  return { marker: MARKER, handle: (request) => handle(request.path, request.body, request.form), seed, dispose };
};

