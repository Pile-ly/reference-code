// The simple-db query keys and the optimistic cache edits record writes
// make. Every edit here is undone per write, never by restoring a snapshot
// of a whole query: with two writes in flight, a snapshot restore for the
// first would erase the second.

import { serviceQueryKey } from "@pilely/core";
import type { ServicePage } from "@pilely/core";
import type { InfiniteData, Query, QueryClient, QueryKey } from "@tanstack/react-query";

import type { DbRecord } from "./types.js";

/** Every optimistic row's id starts with this until its create returns. */
export const TEMP_ID_PREFIX = "pilely-temp-";

export interface RecordListParams {
  eq?: Record<string, unknown>;
  limit?: number;
}

/** `["pilely", "simple-db", "apps"]` */
export const appsKey = (): QueryKey => serviceQueryKey("simple-db", "apps");
/** `["pilely", "simple-db", "tables"]` */
export const tablesKey = (): QueryKey => serviceQueryKey("simple-db", "tables");
/** `["pilely", "simple-db", "records", table]` — every record query of one table. */
export const recordsKey = (table: string): QueryKey => serviceQueryKey("simple-db", "records", table);
/** `["pilely", "simple-db", "records", table, "list"]` — every `useRecords(table, …)`. */
export const recordListsKey = (table: string): QueryKey => [...recordsKey(table), "list"];
export const recordListKey = (table: string, params: RecordListParams): QueryKey => [
  ...recordListsKey(table),
  { eq: params.eq, limit: params.limit },
];
/** `["pilely", "simple-db", "records", table, "get", id]` */
export const recordKey = (table: string, id: string | undefined): QueryKey => [...recordsKey(table), "get", id];

type Row = DbRecord & Record<string, unknown>;
type ListData = InfiniteData<ServicePage<Row, string>, string | null>;

interface Position {
  page: number;
  index: number;
}

interface TempEntry {
  /** The server's id once the create returned; `null` when it failed. */
  realId: string | null | undefined;
  settled: Promise<string | null>;
  resolve(id: string | null): void;
}

/** One pending update's write to one field: what it wrote, and the value
 *  it replaced in each cached query (by query hash). */
interface FieldWrite {
  token: symbol;
  value: unknown;
  previous: Map<string, unknown>;
}

interface CacheState {
  temps: Map<string, TempEntry>;
  fields: Map<string, FieldWrite[]>;
  inFlight: Map<string, number>;
  reconcileIds: Map<string, Set<string>>;
}

const states = new WeakMap<QueryClient, CacheState>();

function stateOf(queryClient: QueryClient): CacheState {
  let state = states.get(queryClient);
  if (!state) {
    state = { temps: new Map(), fields: new Map(), inFlight: new Map(), reconcileIds: new Map() };
    states.set(queryClient, state);
  }
  return state;
}

let tempCounter = 0;

export function isTempId(id: string): boolean {
  return id.startsWith(TEMP_ID_PREFIX);
}

// ── Temporary ids ────────────────────────────────────────────────────────

/** Mints a temporary id and registers it, so a write aimed at it can wait
 *  for the create's real id. */
export function openTempId(queryClient: QueryClient): string {
  tempCounter += 1;
  const id = `${TEMP_ID_PREFIX}${Date.now().toString(36)}-${tempCounter}`;
  let resolve!: (value: string | null) => void;
  const settled = new Promise<string | null>((done) => {
    resolve = done;
  });
  const entry: TempEntry = {
    realId: undefined,
    settled,
    resolve: (realId) => {
      entry.realId = realId;
      resolve(realId);
    },
  };
  stateOf(queryClient).temps.set(id, entry);
  return id;
}

/** Hands the create's outcome to every write waiting on `tempId`. */
export function settleTempId(queryClient: QueryClient, tempId: string, realId: string | null): void {
  stateOf(queryClient).temps.get(tempId)?.resolve(realId);
}

/** The id to send for `id`: itself, or — for a temporary id — the real id
 *  once its create returned, or `null` when the create failed. */
export async function serverId(queryClient: QueryClient, id: string): Promise<string | null> {
  if (!isTempId(id)) {
    return id;
  }
  const entry = stateOf(queryClient).temps.get(id);
  return entry ? entry.settled : null;
}

/** Every id the cached row for `id` may carry right now. */
function idsOf(queryClient: QueryClient, id: string): string[] {
  const realId = stateOf(queryClient).temps.get(id)?.realId;
  return realId ? [id, realId] : [id];
}

// ── In-flight writes and reconciling ─────────────────────────────────────

export function enterWrite(queryClient: QueryClient, table: string): void {
  const { inFlight } = stateOf(queryClient);
  inFlight.set(table, (inFlight.get(table) ?? 0) + 1);
}

/**
 * Ends one record write on `table`. Once no other record write on the
 * table is in flight, invalidates every `useRecords(table, …)` and the
 * `useRecord(table, id)` of every record a write touched since the last
 * reconcile; earlier, it only remembers `ids`, so an early re-fetch never
 * drops a later write's optimistic row.
 */
export async function leaveWrite(queryClient: QueryClient, table: string, ids: string[]): Promise<void> {
  const state = stateOf(queryClient);
  let pending = state.reconcileIds.get(table);
  if (!pending) {
    pending = new Set();
    state.reconcileIds.set(table, pending);
  }
  for (const id of ids) {
    if (!isTempId(id)) {
      pending.add(id);
    }
  }
  const left = (state.inFlight.get(table) ?? 1) - 1;
  if (left > 0) {
    state.inFlight.set(table, left);
    return;
  }
  state.inFlight.delete(table);
  const records = [...pending];
  pending.clear();
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: recordListsKey(table) }),
    ...records.map((id) => queryClient.invalidateQueries({ queryKey: recordKey(table, id), exact: true })),
  ]);
}

/** Cancels in-flight fetches of every list of `table` and of `ids`' own
 *  queries, so a response that left the server before an optimistic edit
 *  cannot land after it. */
export async function cancelRecordQueries(queryClient: QueryClient, table: string, ids: string[]): Promise<void> {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: recordListsKey(table) }),
    ...ids.map((id) => queryClient.cancelQueries({ queryKey: recordKey(table, id), exact: true })),
  ]);
}

// ── List helpers ─────────────────────────────────────────────────────────

function listQueries(queryClient: QueryClient, table: string): Query[] {
  return queryClient.getQueryCache().findAll({ queryKey: recordListsKey(table) });
}

function listParams(query: Query): RecordListParams {
  return (query.queryKey[5] as RecordListParams | undefined) ?? {};
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a === "object" && typeof b === "object" && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/** The server's `eq` test: every key equal, an unset column reading `null`. */
function matchesEq(row: Row, eq: Record<string, unknown> | undefined): boolean {
  if (!eq) {
    return true;
  }
  return Object.entries(eq).every(([key, value]) => sameValue(row[key] ?? null, value));
}

function findRow(data: ListData, ids: string[]): Position | null {
  for (let page = 0; page < data.pages.length; page += 1) {
    const index = data.pages[page]?.rows.findIndex((row) => ids.includes(row.id)) ?? -1;
    if (index >= 0) {
      return { page, index };
    }
  }
  return null;
}

function withPage(data: ListData, page: number, rows: Row[]): ListData {
  const pages = data.pages.slice();
  const current = pages[page];
  if (!current) {
    return data;
  }
  pages[page] = { ...current, rows };
  return { ...data, pages };
}

function replaceAt(data: ListData, at: Position, row: Row): ListData {
  const rows = data.pages[at.page]?.rows.slice() ?? [];
  rows[at.index] = row;
  return withPage(data, at.page, rows);
}

function removeAt(data: ListData, at: Position): ListData {
  const rows = data.pages[at.page]?.rows.slice() ?? [];
  rows.splice(at.index, 1);
  return withPage(data, at.page, rows);
}

function insertAt(data: ListData, at: Position, row: Row): ListData {
  if (data.pages.length === 0) {
    return data;
  }
  const page = Math.min(at.page, data.pages.length - 1);
  const rows = data.pages[page]?.rows.slice() ?? [];
  rows.splice(Math.min(at.index, rows.length), 0, row);
  return withPage(data, page, rows);
}

function editList(queryClient: QueryClient, query: Query, edit: (data: ListData) => ListData | null): void {
  const data = query.state.data as ListData | undefined;
  if (!data || !Array.isArray(data.pages)) {
    return;
  }
  const next = edit(data);
  if (next && next !== data) {
    queryClient.setQueryData(query.queryKey, next);
  }
}

function recordQueries(queryClient: QueryClient, table: string, ids: string[]): Query[] {
  const cache = queryClient.getQueryCache();
  return ids.flatMap((id) => {
    const query = cache.find({ queryKey: recordKey(table, id), exact: true });
    return query ? [query] : [];
  });
}

// ── Create ───────────────────────────────────────────────────────────────

/** Puts `row` at the top of the first page of every cached list of `table`
 *  whose `eq` filter it matches. Returns the undo: remove that row only. */
export function applyCreate(queryClient: QueryClient, table: string, row: Row): () => void {
  for (const query of listQueries(queryClient, table)) {
    if (!matchesEq(row, listParams(query).eq)) {
      continue;
    }
    editList(queryClient, query, (data) => {
      const first = data.pages[0];
      return first ? withPage(data, 0, [row, ...first.rows]) : null;
    });
  }
  return () => {
    for (const query of listQueries(queryClient, table)) {
      editList(queryClient, query, (data) => {
        const at = findRow(data, [row.id]);
        return at ? removeAt(data, at) : null;
      });
    }
  };
}

// ── Update ───────────────────────────────────────────────────────────────

export interface Undo {
  /** The server refused the write: put back what it changed. */
  rollback(): void;
  /** The write is over without a rollback (accepted, or its identity is
   *  gone): forget it. */
  commit(): void;
}

function fieldKey(table: string, id: string, field: string): string {
  return `${table}\u0000${id}\u0000${field}`;
}

/**
 * Applies `patch` to record `id` wherever it is cached. A list whose `eq`
 * filter the patched row no longer matches drops it; a list it now matches
 * does not gain it. The undo restores only the fields this write changed,
 * only where no later pending write has changed them since, and puts a
 * dropped row back where it was.
 */
export function applyUpdate(
  queryClient: QueryClient,
  table: string,
  id: string,
  patch: Record<string, unknown>,
): Undo {
  const token = Symbol("update");
  const fields = Object.keys(patch);
  const previous = new Map<string, Map<string, unknown>>(fields.map((field) => [field, new Map()]));
  const dropped: { hash: string; at: Position; row: Row }[] = [];
  const ids = idsOf(queryClient, id);

  for (const query of listQueries(queryClient, table)) {
    editList(queryClient, query, (data) => {
      const at = findRow(data, ids);
      const row = at ? data.pages[at.page]?.rows[at.index] : undefined;
      if (!at || !row) {
        return null;
      }
      for (const field of fields) {
        previous.get(field)?.set(query.queryHash, row[field]);
      }
      const next = { ...row, ...patch };
      if (!matchesEq(next, listParams(query).eq)) {
        dropped.push({ hash: query.queryHash, at, row });
        return removeAt(data, at);
      }
      return replaceAt(data, at, next);
    });
  }
  for (const query of recordQueries(queryClient, table, ids)) {
    const row = query.state.data as Row | null | undefined;
    if (!row) {
      continue;
    }
    for (const field of fields) {
      previous.get(field)?.set(query.queryHash, row[field]);
    }
    queryClient.setQueryData(query.queryKey, { ...row, ...patch });
  }

  const { fields: stacks } = stateOf(queryClient);
  for (const field of fields) {
    const key = fieldKey(table, id, field);
    const stack = stacks.get(key) ?? [];
    stack.push({ token, value: patch[field], previous: previous.get(field) ?? new Map() });
    stacks.set(key, stack);
  }

  /** Takes this write off its fields' stacks. A write still above it
   *  inherits what it replaced, so a later rollback of that write restores
   *  the value from before both. */
  const release = (restore: boolean): void => {
    for (const field of fields) {
      const key = fieldKey(table, id, field);
      const stack = stacks.get(key);
      const index = stack?.findIndex((write) => write.token === token) ?? -1;
      if (!stack || index < 0) {
        continue;
      }
      const [write] = stack.splice(index, 1);
      if (stack.length === 0) {
        stacks.delete(key);
      }
      if (!write || !restore) {
        continue;
      }
      const above = stack[index];
      if (above) {
        for (const [hash, value] of write.previous) {
          if (above.previous.has(hash)) {
            above.previous.set(hash, value);
          }
        }
        continue;
      }
      restoreField(queryClient, idsOf(queryClient, id), field, write);
    }
  };

  return {
    rollback: () => {
      release(true);
      for (const { hash, at, row } of dropped) {
        const query = queryClient.getQueryCache().get(hash);
        if (!query) {
          continue;
        }
        editList(queryClient, query, (data) => (findRow(data, idsOf(queryClient, id)) ? null : insertAt(data, at, row)));
      }
    },
    commit: () => release(false),
  };
}

function restoreField(queryClient: QueryClient, ids: string[], field: string, write: FieldWrite): void {
  const cache = queryClient.getQueryCache();
  for (const [hash, value] of write.previous) {
    const query = cache.get(hash);
    if (!query) {
      continue;
    }
    const data = query.state.data as ListData | Row | null | undefined;
    if (data && typeof data === "object" && "pages" in data) {
      editList(queryClient, query, (list) => {
        const at = findRow(list, ids);
        const row = at ? list.pages[at.page]?.rows[at.index] : undefined;
        if (!at || !row || !sameValue(row[field], write.value)) {
          return null;
        }
        return replaceAt(list, at, { ...row, [field]: value });
      });
    } else if (data && sameValue(data[field], write.value)) {
      queryClient.setQueryData(query.queryKey, { ...data, [field]: value });
    }
  }
}

// ── Delete ───────────────────────────────────────────────────────────────

/** Removes record `id` from every cached list of `table` and clears its
 *  `useRecord`. The undo puts it back where it was, in each list that has
 *  not regained it, and refills a `useRecord` that is still cleared. */
export function applyDelete(queryClient: QueryClient, table: string, id: string): () => void {
  const ids = idsOf(queryClient, id);
  const removed: { hash: string; at: Position; row: Row }[] = [];
  const cleared: { hash: string; row: Row }[] = [];

  for (const query of listQueries(queryClient, table)) {
    editList(queryClient, query, (data) => {
      const at = findRow(data, ids);
      const row = at ? data.pages[at.page]?.rows[at.index] : undefined;
      if (!at || !row) {
        return null;
      }
      removed.push({ hash: query.queryHash, at, row });
      return removeAt(data, at);
    });
  }
  for (const query of recordQueries(queryClient, table, ids)) {
    const row = query.state.data as Row | null | undefined;
    if (row) {
      cleared.push({ hash: query.queryHash, row });
      queryClient.setQueryData(query.queryKey, null);
    }
  }

  return () => {
    const cache = queryClient.getQueryCache();
    for (const { hash, at, row } of removed) {
      const query = cache.get(hash);
      if (query) {
        editList(queryClient, query, (data) => (findRow(data, [row.id]) ? null : insertAt(data, at, row)));
      }
    }
    for (const { hash, row } of cleared) {
      const query = cache.get(hash);
      if (query && query.state.data === null) {
        queryClient.setQueryData(query.queryKey, row);
      }
    }
  };
}
