// @pilely/simple-email — React hooks over the simple_email service: a query
// hook for every read, a mutation hook for every write. Render them inside
// @pilely/core's <PilelyProvider>. `sendTemplate` is the template send a
// page makes, as a plain function. `send` is the freestyle send for an
// app's backend only; a server imports it from `@pilely/simple-email/send`,
// which loads none of this entry's peers.

export {
  useCreateEmailAccount,
  useCreateTemplate,
  useDeleteEmailAccount,
  useDeleteTemplate,
  useEmailAccount,
  useEmailAccounts,
  useSendTemplate,
  useSetEmailReplyTo,
  useTemplate,
  useTemplates,
  useUpdateTemplate,
} from "./hooks.js";
export type {
  CreateEmailAccountInput,
  CreateTemplateInput,
  PageOptions,
  SendTemplateInput,
  UpdateTemplateInput,
} from "./hooks.js";
export { sendTemplate } from "./api.js";
export type { TemplateSendResult } from "./api.js";
export { SIMPLE_EMAIL_ORIGIN, SendError, send } from "./send.js";
export type { SendContent, SendInput, SendKey, SendOptions, SendResult } from "./send.js";
export type {
  Account,
  SimpleEmailErrorCode,
  AccountCursor,
  AccountInfoEnvelope,
  Template,
  TemplateCursor,
  TemplateMeta,
} from "./types.js";
