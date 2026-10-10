import {
  serviceQueryKey,
  useServiceContext,
  useServiceInfiniteQuery,
  useServiceMutation,
  useServiceQuery,
} from "@pilely/core";
import type { PilelyContextValue } from "@pilely/core";
import { useMutation } from "@tanstack/react-query";
import type { UseInfiniteQueryResult, UseMutationResult, UseQueryResult } from "@tanstack/react-query";

import {
  addColumn,
  createApp,
  createRecord,
  createTable,
  deleteApp,
  deleteRecord,
  getRecord,
  listApps,
  listRecords,
  listTables,
  setNewRowEmail,
  setTableAccess,
  updateRecord,
} from "./api.js";
import type { AddColumnBody, CreateTableBody, DeleteAppOptions, ListPageBody, SetAccessBody } from "./api.js";
import {
  appsKey,
  appsPageKey,
  applyCreate,
  applyDelete,
  applyUpdate,
  cancelRecordQueries,
  enterWrite,
  isTempId,
  leaveWrite,
  openTempId,
  recordKey,
  recordListKey,
  recordsKey,
  serverId,
  settleTempId,
  tablesKey,
  tablesPageKey,
} from "./cache.js";
import type { Undo } from "./cache.js";
import type {
  DbApp,
  DbAppsPage,
  DbEqFilter,
  DbRecord,
  DbRecordOrder,
  DbTable,
  DbTableAccess,
  DbTableNewRowEmail,
  DbTablesPage,
  NewRowEmail,
} from "./types.js";

/** The fields a write sends: every column of `T` except the server-owned
 *  system fields. */
export type RecordFields<T extends DbRecord> = Partial<Omit<T, keyof DbRecord>>;

export interface UseRecordsOptions {
  /** ANDed equality filters on columns, plus `_submitter_user_id` (a user
   *  id; signed-in callers only). */
  eq?: DbEqFilter;
  /** Rows per page; the server defaults to 50 and caps at 100. */
  limit?: number;
  /** `"newest"` (the server's default when omitted) or `"oldest"`. */
  order?: DbRecordOrder;
}

export interface UseRecordOptions {
  /** `true` makes every fetch a strongly consistent read: it reflects every
   *  write that answered before it started, for about twice the read
   *  capacity. The cache entry is the same one an ordinary `useRecord`
   *  of the record uses. */
  consistent?: boolean;
}

export interface RecordWriteOptions {
  /** `false` shows only what the server confirmed: the cache changes only
   *  after the server answered. Default `true`. */
  optimistic?: boolean;
}

export interface UseCreateRecordOptions<T extends DbRecord> extends RecordWriteOptions {
  /** Makes every create create-if-absent: a fixed key, or one derived from
   *  each write's fields (`undefined` sends none). When the submitter
   *  already has a row with the key, nothing is created, the optimistic row
   *  rolls back and `error` holds `PilelyError` `409 key_exists` with that
   *  row's `id`. */
  key?: string | ((fields: RecordFields<T>) => string | undefined);
}

export interface UpdateRecordInput<T extends DbRecord> {
  id: string;
  /** The columns to set; `{}` when `inc` alone changes the record. */
  patch: RecordFields<T>;
  /** The record's `_version` must equal it, else `409 version_conflict`
   *  with `currentVersion` on the error. */
  ifVersion?: number;
  /** Each column must read the value (`null`: reads null), else `409
   *  condition_failed`. */
  if?: { [K in keyof RecordFields<T>]?: RecordFields<T>[K] | null };
  /** An atomic add on `integer` / `real` columns, none also in `patch`. */
  inc?: { [K in keyof RecordFields<T>]?: number };
}

/** `useDeleteRecord`'s variables when the delete is conditional; a bare id
 *  is an unconditional delete. */
export interface DeleteRecordInput {
  id: string;
  /** The record's `_version` must equal it, else `409 version_conflict`
   *  and the record is kept. */
  ifVersion?: number;
}

/** What a record write's `onMutate` hands its later callbacks. */
export interface RecordWriteContext {
  epoch: number;
  tempId?: string;
  undo?: Undo;
}

// ── Records ──────────────────────────────────────────────────────────────

/**
 * The records of `table` in `order` (newest first by default), as an
 * infinite query over the service's cursor: `data` is every loaded record,
 * flattened; `hasNextPage` / `fetchNextPage` load the next page. A filtered
 * page can be short or empty while `hasNextPage` is `true`; only a `null`
 * cursor ends the list.
 */
export function useRecords<T extends DbRecord>(
  table: string,
  options: UseRecordsOptions = {},
): UseInfiniteQueryResult<T[], Error> {
  const { eq, limit, order } = options;
  return useServiceInfiniteQuery<T, string>("useRecords", {
    queryKey: recordListKey(table, { eq, limit, order }),
    fetchPage: async (cursor) => {
      const page = await listRecords<T>(table, {
        ...(limit !== undefined ? { limit } : {}),
        ...(eq ? { eq } : {}),
        ...(order ? { order } : {}),
        ...(cursor ? { cursor } : {}),
      });
      return { rows: page.records, nextCursor: page.next_cursor };
    },
  });
}

function presentRecord<T>(record: T | null): T | undefined {
  return record ?? undefined;
}

/** One record. An `undefined` id (or a still-temporary one) disables the
 *  query; `data` is `undefined` once an optimistic delete cleared it.
 *  `{ consistent: true }` reads it strongly consistently. */
export function useRecord<T extends DbRecord>(
  table: string,
  id: string | undefined,
  options: UseRecordOptions = {},
): UseQueryResult<T | undefined, Error> {
  const { consistent } = options;
  return useServiceQuery<T | null, T | undefined>("useRecord", {
    queryKey: recordKey(table, id),
    queryFn: () => getRecord<T>(table, id as string, consistent !== undefined ? { consistent } : {}),
    enabled: id !== undefined && !isTempId(id),
    select: presentRecord,
  });
}

function settleWrite(context: PilelyContextValue, written: RecordWriteContext | undefined, failed: boolean): void {
  const undo = written?.undo;
  if (!undo) {
    return;
  }
  if (failed && context.epoch() === written.epoch) {
    undo.rollback();
  } else {
    undo.commit();
  }
}

/**
 * Creates a record in `table`. Optimistic by default: a row with a
 * temporary id (prefix `pilely-temp-`) shows before the request goes out at
 * the top of the first page of every matching newest-first
 * `useRecords(table, …)`, and at the end of every matching oldest-first one
 * that has loaded its last page; it is removed again if the server refuses
 * the write. The `error` then holds the
 * `PilelyError` until the next attempt or `reset()`. With `key`, every
 * create is create-if-absent (`409 key_exists` when the row exists).
 */
export function useCreateRecord<T extends DbRecord>(
  table: string,
  options: UseCreateRecordOptions<T> = {},
): UseMutationResult<T, Error, RecordFields<T>, RecordWriteContext> {
  const context = useServiceContext("useCreateRecord");
  const { queryClient } = context;
  const optimistic = options.optimistic ?? true;
  const keyOption = options.key;
  const keyOf = (fields: RecordFields<T>): string | undefined =>
    typeof keyOption === "function" ? keyOption(fields) : keyOption;
  return useMutation<T, Error, RecordFields<T>, RecordWriteContext>(
    {
      mutationKey: recordsKey(table),
      onMutate: async (fields) => {
        const epoch = context.epoch();
        enterWrite(queryClient, table);
        if (!optimistic) {
          return { epoch };
        }
        const tempId = openTempId(queryClient);
        await cancelRecordQueries(queryClient, table, []);
        if (context.epoch() !== epoch) {
          return { epoch, tempId };
        }
        const user = context.currentUser();
        const now = Date.now();
        const row = {
          ...(fields as Record<string, unknown>),
          id: tempId,
          _created_at_ms: now,
          _updated_at_ms: now,
          _version: 1,
          _key: keyOf(fields) ?? null,
          _submitter_handle: user?.handle ?? "",
          ...(user?.id ? { _submitter_user_id: user.id } : {}),
        };
        const remove = applyCreate(queryClient, table, row);
        return { epoch, tempId, undo: { rollback: remove, commit: () => undefined } };
      },
      mutationFn: (fields) => {
        const key = keyOf(fields);
        return createRecord<T>(table, fields as Record<string, unknown>, key !== undefined ? { key } : {});
      },
      onSuccess: (record, _fields, written) => {
        if (written?.tempId) {
          settleTempId(queryClient, written.tempId, record.id);
        }
        settleWrite(context, written, false);
      },
      onError: (_error, _fields, written) => {
        if (written?.tempId) {
          settleTempId(queryClient, written.tempId, null);
        }
        settleWrite(context, written, true);
      },
      onSettled: (record) => leaveWrite(queryClient, table, record ? [record.id] : []),
    },
    queryClient,
  );
}

/**
 * Updates record `id` in `table` with `patch`, optionally conditional on
 * `ifVersion` / `if` and adding `inc` to number columns, all in one atomic
 * step. Optimistic by default: the patch shows wherever the record is
 * cached before the request goes out, and only the fields it changed are
 * restored if the server refuses it, a `409` included. An `inc` column is
 * not changed optimistically: its new value (and the new `_version`) shows
 * when the refresh lands. The server lets the owner update any record; a
 * non-owner only their own records on a `mutate_scope: "own"` table, or
 * any record as a `mutate_group` member — show edit controls accordingly.
 */
export function useUpdateRecord<T extends DbRecord>(
  table: string,
  options: RecordWriteOptions = {},
): UseMutationResult<T, Error, UpdateRecordInput<T>, RecordWriteContext> {
  const context = useServiceContext("useUpdateRecord");
  const { queryClient } = context;
  const optimistic = options.optimistic ?? true;
  return useMutation<T, Error, UpdateRecordInput<T>, RecordWriteContext>(
    {
      mutationKey: recordsKey(table),
      onMutate: async ({ id, patch }) => {
        const epoch = context.epoch();
        enterWrite(queryClient, table);
        if (!optimistic || Object.keys(patch).length === 0) {
          return { epoch };
        }
        await cancelRecordQueries(queryClient, table, [id]);
        if (context.epoch() !== epoch) {
          return { epoch };
        }
        return { epoch, undo: applyUpdate(queryClient, table, id, patch as Record<string, unknown>) };
      },
      mutationFn: async ({ id, patch, ifVersion, if: conditions, inc }) => {
        const realId = await serverId(queryClient, id);
        if (realId === null) {
          throw new Error(`useUpdateRecord: the create behind ${id} failed, so the update was not sent`);
        }
        return updateRecord<T>(table, realId, patch as Record<string, unknown>, {
          ...(ifVersion !== undefined ? { ifVersion } : {}),
          ...(conditions !== undefined ? { if: conditions as Record<string, unknown> } : {}),
          ...(inc !== undefined ? { inc: inc as Record<string, number> } : {}),
        });
      },
      onSuccess: (_record, _input, written) => settleWrite(context, written, false),
      onError: (_error, _input, written) => settleWrite(context, written, true),
      onSettled: (record, _error, { id }) => leaveWrite(queryClient, table, record ? [id, record.id] : [id]),
    },
    queryClient,
  );
}

function deleteTarget(input: string | DeleteRecordInput): DeleteRecordInput {
  return typeof input === "string" ? { id: input } : input;
}

/**
 * Deletes record `id` from `table` — or, given `{ id, ifVersion }`, only
 * while the record is at that `_version`. Optimistic by default: the record
 * leaves every cached list (and its `useRecord` clears) before the request
 * goes out, and returns to where it was if the server refuses it, a `409`
 * included. The server lets the owner delete any record; a non-owner only
 * their own records on a `mutate_scope: "own"` table, or any record as a
 * `mutate_group` member — show delete controls accordingly.
 */
export function useDeleteRecord(
  table: string,
  options: RecordWriteOptions = {},
): UseMutationResult<string, Error, string | DeleteRecordInput, RecordWriteContext> {
  const context = useServiceContext("useDeleteRecord");
  const { queryClient } = context;
  const optimistic = options.optimistic ?? true;
  return useMutation<string, Error, string | DeleteRecordInput, RecordWriteContext>(
    {
      mutationKey: recordsKey(table),
      onMutate: async (input) => {
        const { id } = deleteTarget(input);
        const epoch = context.epoch();
        enterWrite(queryClient, table);
        if (!optimistic) {
          return { epoch };
        }
        await cancelRecordQueries(queryClient, table, [id]);
        if (context.epoch() !== epoch) {
          return { epoch };
        }
        return { epoch, undo: { rollback: applyDelete(queryClient, table, id), commit: () => undefined } };
      },
      mutationFn: async (input) => {
        const { id, ifVersion } = deleteTarget(input);
        const realId = await serverId(queryClient, id);
        // A row whose create failed never existed on the server.
        return realId === null ? id : deleteRecord(table, realId, ifVersion !== undefined ? { ifVersion } : {});
      },
      onSuccess: (_deleted, _input, written) => settleWrite(context, written, false),
      onError: (_error, _input, written) => settleWrite(context, written, true),
      onSettled: (deleted, _error, input) => {
        const { id } = deleteTarget(input);
        return leaveWrite(queryClient, table, deleted ? [id, deleted] : [id]);
      },
    },
    queryClient,
  );
}

// ── Tables (owner-only) ──────────────────────────────────────────────────

/** The body a list hook sends: only the params the caller set. */
function pageBody({ limit, cursor }: ListPageBody): ListPageBody {
  return {
    ...(limit !== undefined ? { limit } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
  };
}

/**
 * One page of the app's tables, oldest first: `data` is `{ tables,
 * nextCursor }`. No params means the first page; pass `nextCursor` back as
 * `cursor` for the next one. Owner-only.
 */
export function useTables(params: ListPageBody = {}): UseQueryResult<DbTablesPage, Error> {
  const body = pageBody(params);
  return useServiceQuery<DbTablesPage>("useTables", {
    queryKey: tablesPageKey(body),
    queryFn: () => listTables(body),
  });
}

/** Creates a table. Owner-only — a setup step for the app's own admin
 *  screens, never something a visitor's page load does. */
export function useCreateTable(): UseMutationResult<DbTable, Error, CreateTableBody> {
  return useServiceMutation<DbTable, CreateTableBody>("useCreateTable", {
    mutationFn: createTable,
    invalidates: () => [tablesKey()],
  });
}

export interface AddColumnInput {
  table: string;
  column: AddColumnBody;
}

/** Adds a column to a table. Owner-only. */
export function useAddColumn(): UseMutationResult<DbTable, Error, AddColumnInput> {
  return useServiceMutation<DbTable, AddColumnInput>("useAddColumn", {
    mutationFn: ({ table, column }) => addColumn(table, column),
    invalidates: () => [tablesKey()],
  });
}

export interface SetTableAccessInput {
  table: string;
  access: SetAccessBody;
}

/** Replaces a table's access groups and `anon_read`, and changes the
 *  row-level settings it names (an omitted one keeps its value). Owner-only. */
export function useSetTableAccess(): UseMutationResult<DbTableAccess, Error, SetTableAccessInput> {
  return useServiceMutation<DbTableAccess, SetTableAccessInput>("useSetTableAccess", {
    mutationFn: ({ table, access }) => setTableAccess(table, access),
    invalidates: (_access, { table }) => [tablesKey(), recordsKey(table)],
  });
}

export interface SetNewRowEmailInput {
  table: string;
  new_row_email: NewRowEmail;
}

/** Sets whether the owner is emailed when other people create rows in a
 *  table (`"off"`, `"each"` or `"daily"`). `"each"` and `"daily"` need the
 *  app's `@simple_email` account to be able to send, else `400
 *  email_not_ready` and the table keeps its value. Owner-only. */
export function useSetNewRowEmail(): UseMutationResult<DbTableNewRowEmail, Error, SetNewRowEmailInput> {
  return useServiceMutation<DbTableNewRowEmail, SetNewRowEmailInput>("useSetNewRowEmail", {
    mutationFn: ({ table, new_row_email }) => setNewRowEmail(table, new_row_email),
    invalidates: () => [tablesKey()],
  });
}

// ── Apps (owner-only) ────────────────────────────────────────────────────

/**
 * One page of the owner's simple-db apps, newest first: `data` is `{ apps,
 * nextCursor }`. No params means the first page; pass `nextCursor` back as
 * `cursor` for the next one. Owner-only.
 */
export function useDbApps(params: ListPageBody = {}): UseQueryResult<DbAppsPage, Error> {
  const body = pageBody(params);
  return useServiceQuery<DbAppsPage>("useDbApps", {
    queryKey: appsPageKey(body),
    queryFn: () => listApps(body),
  });
}

/** Creates this app's database. Owner-only. */
export function useCreateDbApp(): UseMutationResult<DbApp, Error, void> {
  return useServiceMutation<DbApp, void>("useCreateDbApp", {
    mutationFn: () => createApp(),
    invalidates: () => [appsKey()],
  });
}

/** Drops this app's database — every table and record, with no undo.
 *  Owner-only. */
export function useDeleteDbApp(): UseMutationResult<string, Error, DeleteAppOptions | void> {
  return useServiceMutation<string, DeleteAppOptions | void>("useDeleteDbApp", {
    mutationFn: (options) => deleteApp(options ?? {}),
    invalidates: () => [serviceQueryKey("simple-db")],
  });
}
