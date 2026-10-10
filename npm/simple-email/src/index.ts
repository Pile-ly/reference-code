// @pilely/simple-email — React hooks over the simple_email service: a query
// hook for every read, a mutation hook for every write. Render them inside
// @pilely/core's <PilelyProvider>.

export {
  useCreateEmailAccount,
  useCreateTemplate,
  useDeleteEmailAccount,
  useDeleteTemplate,
  useEmailAccount,
  useEmailAccounts,
  useSend,
  useSends,
  useSetEmailAccountAccess,
  useTemplate,
  useTemplates,
  useUpdateTemplate,
} from "./hooks.js";
export type {
  CreateEmailAccountInput,
  CreateTemplateInput,
  PageOptions,
  SetEmailAccountAccessInput,
  UpdateTemplateInput,
} from "./hooks.js";
export type { AccountSendInput, RawSendInput, SendContent, SendInput, SendKey, SendResult } from "./api.js";
export type {
  Account,
  AccountSenders,
  SimpleEmailErrorCode,
  AccountCursor,
  AccountInfoEnvelope,
  SendCursor,
  SendRow,
  Template,
  TemplateCursor,
  TemplateMeta,
  ToAccount,
} from "./types.js";
