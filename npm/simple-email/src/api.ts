// The simple_email service's 12 POST routes, one function each. This is the
// internal layer the hooks in hooks.ts call; the package exports the hooks,
// not these. app_id moves between the body and the path from route to
// route on this service.

import { appId, call, collectPages, isMockMode, registerMockService } from "@pilely/core";

import { createSimpleEmailFake } from "./mock.js";
import type {
  Account,
  AccountCursor,
  AccountInfoEnvelope,
  AccountSenders,
  SendCursor,
  SendRow,
  Template,
  TemplateCursor,
  TemplateMeta,
  ToAccount,
} from "./types.js";

// Importing this package (its hooks import this module) is all an app does
// to get its fake in mock mode. Dead code in a build without
// `VITE_PILELY_MOCK=1`, fake included.
if (isMockMode()) {
  registerMockService("simple-email", createSimpleEmailFake);
}

/**
 * Every route on this service needs an app id on the wire (body or path).
 * `@pilely/core`'s `appId()` can return `null` (no tag, `ready()` not yet
 * resolved) — this service cannot send that: a `null` in a path template
 * would silently become the literal string `"null"`. Fail loudly instead.
 */
function requireAppId(): string {
  const id = appId();
  if (!id) {
    throw new Error(
      'pilely client not loaded, <meta name="pilely-app"> missing, and no token pile_id claim available yet — call after ready()',
    );
  }
  return id;
}

/** `to` is capped at the service's `max_recipients_per_send` (50 by default). */
export type SendContent =
  | { template_id: string; variables?: Record<string, string> }
  | { subject: string; html: string };

/**
 * Optional on every send shape: 1–128 characters of `[A-Za-z0-9._:-]`, held
 * per app for 24 hours from its first use. A repeat with the same key, the
 * same body and the same caller answers the first send's `send_id` with
 * `replayed: true` and sends and bills nothing; the same key with another
 * body or caller is `409 idempotency_key_reused`. Pick keys stable per
 * logical email (`digest:<user id>:<YYYY-MM-DD>`, `confirm:<row id>`) — a
 * new key per attempt defeats the protection.
 */
export interface SendKey {
  idempotency_key?: string;
}

/** A raw send: to the addresses in `to`, template or inline content. */
export type RawSendInput = { to: string[]; to_account?: never } & SendContent & SendKey;

/**
 * An account send: a template to ONE address the service looks up itself —
 * the caller's own account email (`"self"`) or the account owner's
 * (`"owner"`). No `to`, and template content only: `subject` / `html` are a
 * 400 on the server, so they do not typecheck here.
 */
export type AccountSendInput = {
  to_account: ToAccount;
  to?: never;
  template_id: string;
  variables?: Record<string, string>;
  subject?: never;
  html?: never;
} & SendKey;

/** Exactly one of `to` (a raw send) or `to_account` (an account send). */
export type SendInput = RawSendInput | AccountSendInput;

/** `replayed` is `true` when the answer is an earlier keyed send's (nothing
 *  new was sent), `false` for a new send — and always `false` without an
 *  `idempotency_key`. An account send's answer never carries an address. */
export interface SendResult {
  send_id: string;
  recipient_count: number;
  replayed: boolean;
}

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
export async function send(input: SendInput): Promise<SendResult> {
  const app_id = requireAppId();
  const idempotency_key = input.idempotency_key;
  const body =
    input.to_account !== undefined
      ? { app_id, to_account: input.to_account, template_id: input.template_id, variables: input.variables, idempotency_key }
      : "template_id" in input
        ? { app_id, to: input.to, template_id: input.template_id, variables: input.variables, idempotency_key }
        : { app_id, to: input.to, subject: input.subject, html: input.html, idempotency_key };
  return call<SendResult>({
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
      app_id: requireAppId(),
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
 *  is the opposite: its key is always required. `accountSenders` is
 *  optional too, and left off the wire when `undefined` (the server then
 *  uses `"send_group"`; it refuses an explicit `null` with a 400). */
export async function createAccount(sendGroup?: string | null, accountSenders?: AccountSenders): Promise<Account> {
  const body: { app_id: string; send_group?: string | null; account_senders?: AccountSenders } = {
    app_id: requireAppId(),
  };
  if (sendGroup !== undefined) {
    body.send_group = sendGroup;
  }
  if (accountSenders !== undefined) {
    body.account_senders = accountSenders;
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
    path: `/accounts/${requireAppId()}/info`,
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
  await call<{ ok: true }>({ service: "simple-email", path: `/accounts/${requireAppId()}/delete` });
}

/** `sendGroup` is REQUIRED here and its key is always sent, even `null` —
 *  the opposite of `createAccount`, where the key is optional. `null`
 *  means owner-only. `accountSenders` is optional: `undefined` leaves the
 *  key off the wire, which KEEPS the account's current value. */
export async function setAccountAccess(sendGroup: string | null, accountSenders?: AccountSenders): Promise<Account> {
  const body: { send_group: string | null; account_senders?: AccountSenders } = { send_group: sendGroup };
  if (accountSenders !== undefined) {
    body.account_senders = accountSenders;
  }
  const json = await call<{ account: Account }>({
    service: "simple-email",
    path: `/accounts/${requireAppId()}/access/set`,
    body,
  });
  return json.account;
}

// ── Templates (nested under the account) ────────────────────────────────

/** Returns metadata only — no `html`. Use `templateInfo` to read the body
 *  back.
 *
 *  `name` is nullable because the service accepts a nameless template. It
 *  stays a required POSITIONAL parameter — pass an explicit `null`, not
 *  nothing — and `TemplateMeta.name` then comes back `null`. */
export async function createTemplate(
  name: string | null,
  subject: string,
  html: string,
): Promise<TemplateMeta> {
  const json = await call<{ template: TemplateMeta }>({
    service: "simple-email",
    path: `/accounts/${requireAppId()}/templates/create`,
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
    path: `/accounts/${requireAppId()}/templates/list`,
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
    path: `/accounts/${requireAppId()}/templates/${templateNanoid}/info`,
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
    path: `/accounts/${requireAppId()}/templates/${templateNanoid}/update`,
    body,
  });
  return json.template;
}

export async function deleteTemplate(templateNanoid: string): Promise<void> {
  await call<{ ok: true }>({
    service: "simple-email",
    path: `/accounts/${requireAppId()}/templates/${templateNanoid}/delete`,
  });
}
