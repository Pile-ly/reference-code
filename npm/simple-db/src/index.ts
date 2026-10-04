// @pilely/simple-db — React hooks over the simple_db service: a query hook
// for every read, a mutation hook for every write, record writes
// optimistic. Render them inside @pilely/core's <PilelyProvider>.

export {
  useAddColumn,
  useCreateDbApp,
  useCreateRecord,
  useCreateTable,
  useDbApps,
  useDeleteDbApp,
  useDeleteRecord,
  useRecord,
  useRecords,
  useSetTableAccess,
  useTables,
  useUpdateRecord,
} from "./hooks.js";
export type {
  AddColumnInput,
  RecordFields,
  RecordWriteContext,
  RecordWriteOptions,
  SetTableAccessInput,
  UpdateRecordInput,
  UseRecordsOptions,
} from "./hooks.js";
export { TEMP_ID_PREFIX } from "./cache.js";
export type { AddColumnBody, CreateTableBody, DeleteAppOptions, SetAccessBody } from "./api.js";
export type {
  DbApp,
  SimpleDbErrorCode,
  DbColumn,
  DbColumnType,
  DbListPage,
  DbRecord,
  DbTable,
  DbTableAccess,
} from "./types.js";
