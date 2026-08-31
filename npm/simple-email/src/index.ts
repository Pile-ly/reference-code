// @pilely/simple-email — a typed wrapper over the simple_email service's 12
// POST routes. See README.md for where app_id lives on each route: this is
// the one service where it moves between the body and the path.

import { appId, call, collectPages } from "@pilely/core";

import type {
  Account,
  AccountCursor,
  AccountInfoEnvelope,
  SendCursor,
  SendRow,
  Template,
  TemplateCursor,
  TemplateMeta,
} from "./types.js";

export type {
  Account,
  AccountCursor,
  AccountInfoEnvelope,
  SendCursor,
  SendRow,
  Template,
  TemplateCursor,
  TemplateMeta,
} from "./types.js";

/** `to` is capped at the service's `max_recipients_per_send` (50 by default). */
export type SendContent =
  | { template_id: string; variables?: Record<string, string> }
  | { subject: string; html: string };

export type SendInput = { to: string[] } & SendContent;

export interface ListSendsOptions {
  limit?: number;
  after_created_time_stamp?: number;
  after_send_id?: string;
}

export interface ListAccountsOptions {
  limit?: number;
  after_created_time_stamp?: number;
  after_app_id?: string;
}

export interface ListTemplatesOptions {
  limit?: number;
  after_created_time_stamp?: number;
  after_template_id?: string;
}

/** Both keys are REQUIRED — the server rejects either one missing with a
 *  400 (`ContentField::validate`), matching `updateTemplate`'s full-replace
 *  contract: there is no patch form on this route. */
export interface UpdateTemplateBody {
  subject: string;
  html: string;
}

// ── Sending ──────────────────────────────────────────────────────────────

/**
 * `app_id` is added from core's `appId()` — it is not a caller parameter.
 * Body size is capped on this route (like `createTemplate`/`updateTemplate`):
 * an oversize body is rejected by the server before any handler runs, so
 * the failure is not an `{ok:false}` envelope and the thrown `PilelyError`
 * carries a null `code`.
 */
export async function send(input: SendInput): Promise<{ send_id: string; recipient_count: number }> {
  const body =
    "template_id" in input
      ? { app_id: appId(), to: input.to, template_id: input.template_id, variables: input.variables }
      : { app_id: appId(), to: input.to, subject: input.subject, html: input.html };
  return call<{ send_id: string; recipient_count: number }>({
    service: "simple-email",
    path: "/send",
    body,
  });
}

/** `app_id` lives in the body here, like `send` — not in the path. The
 *  paged primitive; use `listAllSends` to walk to the end. */
export async function listSends(
  options: ListSendsOptions = {},
): Promise<{ sends: SendRow[]; next_cursor: SendCursor | null }> {
  const json = await call<{ sends: SendRow[]; next_cursor: SendCursor | null }>({
    service: "simple-email",
    path: "/sends/list",
    body: {
      app_id: appId(),
      limit: options.limit,
      after_created_time_stamp: options.after_created_time_stamp,
      after_send_id: options.after_send_id,
    },
  });
  return { sends: json.sends, next_cursor: json.next_cursor };
}

export async function listAllSends(): Promise<SendRow[]> {
  return collectPages<SendRow, SendCursor>(async (cursor) => {
    const page = await listSends({ limit: 100, ...(cursor ?? {}) });
    return { rows: page.sends, nextCursor: page.next_cursor };
  });
}

// ── Accounts ─────────────────────────────────────────────────────────────

/** `sendGroup` is optional here — omit it (or pass `undefined`) and the
 *  key is left off the wire, meaning owner-only. `setAccountAccess` below
 *  is the opposite: its key is always required. */
export async function createAccount(sendGroup?: string | null): Promise<Account> {
  const body: { app_id: string; send_group?: string | null } = { app_id: appId() };
  if (sendGroup !== undefined) {
    body.send_group = sendGroup;
  }
  const json = await call<{ account: Account }>({
    service: "simple-email",
    path: "/accounts/create",
    body,
  });
  return json.account;
}

/** No `app_id` anywhere on this route — `after_app_id` is a cursor field,
 *  not a selector. The paged primitive; use `listAllAccounts` to walk to
 *  the end. */
export async function listAccounts(
  options: ListAccountsOptions = {},
): Promise<{ accounts: Account[]; next_cursor: AccountCursor | null }> {
  const json = await call<{ accounts: Account[]; next_cursor: AccountCursor | null }>({
    service: "simple-email",
    path: "/accounts/list",
    body: {
      limit: options.limit,
      after_created_time_stamp: options.after_created_time_stamp,
      after_app_id: options.after_app_id,
    },
  });
  return { accounts: json.accounts, next_cursor: json.next_cursor };
}

export async function listAllAccounts(): Promise<Account[]> {
  return collectPages<Account, AccountCursor>(async (cursor) => {
    const page = await listAccounts({ limit: 100, ...(cursor ?? {}) });
    return { rows: page.accounts, nextCursor: page.next_cursor };
  });
}

/** Returns the account plus its live operational state — the four extra
 *  fields are nullable siblings of `account`, not nested inside it. */
export async function accountInfo(): Promise<AccountInfoEnvelope> {
  const json = await call<AccountInfoEnvelope>({
    service: "simple-email",
    path: `/accounts/${appId()}/info`,
  });
  return {
    account: json.account,
    daily_cap: json.daily_cap,
    sent_today: json.sent_today,
    credit_blocked: json.credit_blocked,
    phone_verified: json.phone_verified,
  };
}

export async function deleteAccount(): Promise<void> {
  await call<{ ok: true }>({ service: "simple-email", path: `/accounts/${appId()}/delete` });
}

/** `sendGroup` is REQUIRED here and its key is always sent, even `null` —
 *  the opposite of `createAccount`, where the key is optional. `null`
 *  means owner-only. */
export async function setAccountAccess(sendGroup: string | null): Promise<Account> {
  const json = await call<{ account: Account }>({
    service: "simple-email",
    path: `/accounts/${appId()}/access/set`,
    body: { send_group: sendGroup },
  });
  return json.account;
}

// ── Templates (nested under the account) ────────────────────────────────

/** Returns metadata only — no `html`. Use `templateInfo` to read the body
 *  back. */
export async function createTemplate(name: string, subject: string, html: string): Promise<TemplateMeta> {
  const json = await call<{ template: TemplateMeta }>({
    service: "simple-email",
    path: `/accounts/${appId()}/templates/create`,
    body: { name, subject, html },
  });
  return json.template;
}

/** The paged primitive; use `listAllTemplates` to walk to the end. Rows
 *  carry metadata only — no `html`. */
export async function listTemplates(
  options: ListTemplatesOptions = {},
): Promise<{ templates: TemplateMeta[]; next_cursor: TemplateCursor | null }> {
  const json = await call<{ templates: TemplateMeta[]; next_cursor: TemplateCursor | null }>({
    service: "simple-email",
    path: `/accounts/${appId()}/templates/list`,
    body: {
      limit: options.limit,
      after_created_time_stamp: options.after_created_time_stamp,
      after_template_id: options.after_template_id,
    },
  });
  return { templates: json.templates, next_cursor: json.next_cursor };
}

export async function listAllTemplates(): Promise<TemplateMeta[]> {
  return collectPages<TemplateMeta, TemplateCursor>(async (cursor) => {
    const page = await listTemplates({ limit: 100, ...(cursor ?? {}) });
    return { rows: page.templates, nextCursor: page.next_cursor };
  });
}

/** The only template route whose answer carries `html`. */
export async function templateInfo(templateNanoid: string): Promise<Template> {
  const json = await call<{ template: Template }>({
    service: "simple-email",
    path: `/accounts/${appId()}/templates/${templateNanoid}/info`,
  });
  return json.template;
}

/**
 * A FULL REPLACE of both `subject` and `html` — never a patch — and `name`
 * is not updatable at all. Returns metadata only, like `createTemplate`.
 * Subject to the same oversize-body caveat as `send`/`createTemplate`.
 */
export async function updateTemplate(
  templateNanoid: string,
  body: UpdateTemplateBody,
): Promise<TemplateMeta> {
  const json = await call<{ template: TemplateMeta }>({
    service: "simple-email",
    path: `/accounts/${appId()}/templates/${templateNanoid}/update`,
    body,
  });
  return json.template;
}

export async function deleteTemplate(templateNanoid: string): Promise<void> {
  await call<{ ok: true }>({
    service: "simple-email",
    path: `/accounts/${appId()}/templates/${templateNanoid}/delete`,
  });
}
