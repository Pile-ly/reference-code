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
  setTableAccess,
  updateRecord,
} from "./api.js";
import type { AddColumnBody, CreateTableBody, DeleteAppOptions, SetAccessBody } from "./api.js";
import {
  appsKey,
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
} from "./cache.js";
import type { Undo } from "./cache.js";
import type { DbApp, DbRecord, DbTable, DbTableAccess } from "./types.js";

/** The fields a write sends: every column of `T` except the server-owned
 *  system fields. */
export type RecordFields<T extends DbRecord> = Partial<Omit<T, keyof DbRecord>>;

export interface UseRecordsOptions {
  /** ANDed equality filters on columns. */
  eq?: Record<string, unknown>;
  /** Rows per page; the server defaults to 50 and caps at 100. */
  limit?: number;
}

export interface RecordWriteOptions {
  /** `false` shows only what the server confirmed: the cache changes only
   *  after the server answered. Default `true`. */
  optimistic?: boolean;
}

export interface UpdateRecordInput<T extends DbRecord> {
  id: string;
  patch: RecordFields<T>;
}

/** What a record write's `onMutate` hands its later callbacks. */
export interface RecordWriteContext {
  epoch: number;
  tempId?: string;
  undo?: Undo;
}

// ── Records ──────────────────────────────────────────────────────────────

/**
 * The records of `table`, newest first, as an infinite query over the
 * service's cursor: `data` is every loaded record, flattened; `hasNextPage`
 * / `fetchNextPage` load the next page.
 */
export function useRecords<T extends DbRecord>(
  table: string,
  options: UseRecordsOptions = {},
): UseInfiniteQueryResult<T[], Error> {
  const { eq, limit } = options;
  return useServiceInfiniteQuery<T, string>("useRecords", {
    queryKey: recordListKey(table, { eq, limit }),
    fetchPage: async (cursor) => {
      const page = await listRecords<T>(table, {
        ...(limit !== undefined ? { limit } : {}),
        ...(eq ? { eq } : {}),
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
 *  query; `data` is `undefined` once an optimistic delete cleared it. */
export function useRecord<T extends DbRecord>(
  table: string,
  id: string | undefined,
): UseQueryResult<T | undefined, Error> {
  return useServiceQuery<T | null, T | undefined>("useRecord", {
    queryKey: recordKey(table, id),
    queryFn: () => getRecord<T>(table, id as string),
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
 * temporary id (prefix `pilely-temp-`) shows at the top of the first page of
 * every matching `useRecords(table, …)` before the request goes out, and is
 * removed again if the server refuses the write. The `error` then holds the
 * `PilelyError` until the next attempt or `reset()`.
 */
export function useCreateRecord<T extends DbRecord>(
  table: string,
  options: RecordWriteOptions = {},
): UseMutationResult<T, Error, RecordFields<T>, RecordWriteContext> {
  const context = useServiceContext("useCreateRecord");
  const { queryClient } = context;
  const optimistic = options.optimistic ?? true;
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
          _submitter_handle: user?.handle ?? "",
          ...(user?.id ? { _submitter_user_id: user.id } : {}),
        };
        const remove = applyCreate(queryClient, table, row);
        return { epoch, tempId, undo: { rollback: remove, commit: () => undefined } };
      },
      mutationFn: (fields) => createRecord<T>(table, fields as Record<string, unknown>),
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
 * Updates record `id` in `table` with `patch`. Optimistic by default: the
 * patch shows wherever the record is cached before the request goes out,
 * and only the fields it changed are restored if the server refuses it.
 * Owner-only on the server, so show edit controls to the owner only.
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
        if (!optimistic) {
          return { epoch };
        }
        await cancelRecordQueries(queryClient, table, [id]);
        if (context.epoch() !== epoch) {
          return { epoch };
        }
        return { epoch, undo: applyUpdate(queryClient, table, id, patch as Record<string, unknown>) };
      },
      mutationFn: async ({ id, patch }) => {
        const realId = await serverId(queryClient, id);
        if (realId === null) {
          throw new Error(`useUpdateRecord: the create behind ${id} failed, so the update was not sent`);
        }
        return updateRecord<T>(table, realId, patch as Record<string, unknown>);
      },
      onSuccess: (_record, _input, written) => settleWrite(context, written, false),
      onError: (_error, _input, written) => settleWrite(context, written, true),
      onSettled: (record, _error, { id }) => leaveWrite(queryClient, table, record ? [id, record.id] : [id]),
    },
    queryClient,
  );
}

/**
 * Deletes record `id` from `table`. Optimistic by default: the record
 * leaves every cached list (and its `useRecord` clears) before the request
 * goes out, and returns to where it was if the server refuses it.
 * Owner-only on the server, so show delete controls to the owner only.
 */
export function useDeleteRecord(
  table: string,
  options: RecordWriteOptions = {},
): UseMutationResult<string, Error, string, RecordWriteContext> {
  const context = useServiceContext("useDeleteRecord");
  const { queryClient } = context;
  const optimistic = options.optimistic ?? true;
  return useMutation<string, Error, string, RecordWriteContext>(
    {
      mutationKey: recordsKey(table),
      onMutate: async (id) => {
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
      mutationFn: async (id) => {
        const realId = await serverId(queryClient, id);
        // A row whose create failed never existed on the server.
        return realId === null ? id : deleteRecord(table, realId);
      },
      onSuccess: (_deleted, _id, written) => settleWrite(context, written, false),
      onError: (_error, _id, written) => settleWrite(context, written, true),
      onSettled: (deleted, _error, id) => leaveWrite(queryClient, table, deleted ? [id, deleted] : [id]),
    },
    queryClient,
  );
}

// ── Tables (owner-only) ──────────────────────────────────────────────────

/** The app's tables. Owner-only. */
export function useTables(): UseQueryResult<DbTable[], Error> {
  return useServiceQuery<DbTable[]>("useTables", { queryKey: tablesKey(), queryFn: listTables });
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

/** Replaces a table's access groups. Owner-only. */
export function useSetTableAccess(): UseMutationResult<DbTableAccess, Error, SetTableAccessInput> {
  return useServiceMutation<DbTableAccess, SetTableAccessInput>("useSetTableAccess", {
    mutationFn: ({ table, access }) => setTableAccess(table, access),
    invalidates: (_access, { table }) => [tablesKey(), recordsKey(table)],
  });
}

// ── Apps (owner-only) ────────────────────────────────────────────────────

/** The owner's simple-db apps. Owner-only. */
export function useDbApps(): UseQueryResult<DbApp[], Error> {
  return useServiceQuery<DbApp[]>("useDbApps", { queryKey: appsKey(), queryFn: listApps });
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
