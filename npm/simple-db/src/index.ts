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
  useSetNewRowEmail,
  useSetTableAccess,
  useTables,
  useUpdateRecord,
} from "./hooks.js";
export type {
  AddColumnInput,
  DeleteRecordInput,
  RecordFields,
  RecordWriteContext,
  RecordWriteOptions,
  SetNewRowEmailInput,
  SetTableAccessInput,
  UpdateRecordInput,
  UseCreateRecordOptions,
  UseRecordOptions,
  UseRecordsOptions,
} from "./hooks.js";
export { TEMP_ID_PREFIX } from "./cache.js";
export type {
  AddColumnBody,
  CreateRecordOptions,
  CreateTableBody,
  DeleteAppOptions,
  DeleteRecordOptions,
  GetRecordOptions,
  ListPageBody,
  RowAccessBody,
  SetAccessBody,
  UpdateRecordOptions,
} from "./api.js";
export type {
  DbApp,
  DbAppsPage,
  SimpleDbErrorCode,
  DbColumn,
  DbColumnType,
  DbEqFilter,
  DbListPage,
  DbMutateScope,
  DbReadScope,
  DbRecord,
  DbRecordOrder,
  DbRowAccess,
  DbTable,
  DbTableAccess,
  DbTableNewRowEmail,
  DbTablesPage,
  NewRowEmail,
} from "./types.js";
