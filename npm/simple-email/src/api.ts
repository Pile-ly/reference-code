// The simple_email service's page-side POST routes, one function each: the
// template send and the owner's account and template management. This is
// the layer the hooks in hooks.ts call; the package exports the hooks and
// `sendTemplate`, not the rest. app_id is in the path on every route but
// `accounts/create` (body) and `accounts/list` (none). Every function takes
// `{ challenge }` — a bot-check answer, or a function asked once per
// request — and every request it sends carries it. The freestyle send is
// not here: only an app's backend may make it, so it lives in send.ts,
// which needs no browser runtime.

import { appId, call, collectPages, isMockMode, registerMockService } from "@pilely/core";
import type { ChallengeOption } from "@pilely/core";

import { createSimpleEmailFake } from "./mock.js";
import type { Account, AccountCursor, AccountInfoEnvelope, Template, TemplateCursor, TemplateMeta } from "./types.js";

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

/** The template send's answer. Never the template's recipient. */
export interface TemplateSendResult {
  send_id: string;
}

/** `recipient` is REQUIRED: the ONE address every template send of this
 *  template goes to — any address the owner likes, never verified. The two
 *  groups are optional; omitted or `null` is an empty group. `send_group`
 *  takes an owner group or one of the two platform-wide groups (anonymous,
 *  authenticated — `@pilely/simple-group`'s `anonymousGroupId()` /
 *  `authenticatedGroupId()`); `deny_group` takes an owner group only. */
export interface CreateTemplateBody {
  /** `null` for a nameless template. */
  name: string | null;
  subject: string;
  html: string;
  recipient: string;
  send_group?: string | null;
  deny_group?: string | null;
}

/** `subject` and `html` are REQUIRED — the server rejects either one missing
 *  with a 400: the content is always a full replace. The other three are
 *  optional: an omitted key keeps the stored value, `null` empties a group,
 *  and `recipient` cannot be emptied (`null` is a 400, so it does not
 *  typecheck). */
export interface UpdateTemplateBody {
  subject: string;
  html: string;
  recipient?: string;
  send_group?: string | null;
  deny_group?: string | null;
}

// ── Sending ──────────────────────────────────────────────────────────────

/**
 * The template send: `POST /accounts/{app_id}/templates/{template_id}/send`
 * with the page's own app id. Sends that template, filled from `variables`,
 * to the one recipient the owner stored on it — the caller can never point
 * it anywhere else. `variables` is the body itself: each placeholder of the
 * template's subject and html is read from the field of the same name, and
 * every other field is ignored. A missing placeholder is a 400 and nothing
 * is sent. The service admits the caller only when it is in the template's
 * `send_group` and not in its `deny_group`; everyone else, an unknown
 * template and an exhausted owner balance alike, gets the uniform 404.
 */
export async function sendTemplate(
  templateId: string,
  variables: Record<string, string> = {},
  { challenge }: ChallengeOption = {},
): Promise<TemplateSendResult> {
  const json = await call<{ send_id: string }>({
    service: "simple-email",
    path: `/accounts/${requireAppId()}/templates/${templateId}/send`,
    body: variables,
    challenge,
  });
  return { send_id: json.send_id };
}

// ── Accounts ─────────────────────────────────────────────────────────────

/** `replyTo` is optional: `undefined` leaves the key off the wire, and
 *  omitted or `null` both mean no reply-to. The account carries no send
 *  access of its own — who may send is each template's groups, and the
 *  app's backend. */
export async function createAccount(replyTo?: string | null, { challenge }: ChallengeOption = {}): Promise<Account> {
  const body: { app_id: string; reply_to?: string | null } = { app_id: requireAppId() };
  if (replyTo !== undefined) {
    body.reply_to = replyTo;
  }
  const json = await call<{ account: Account }>({
    service: "simple-email",
    path: "/accounts/create",
    body,
    challenge,
  });
  return json.account;
}

/** No `app_id` anywhere on this route — `after_app_id` is a cursor field,
 *  not a selector. The paged primitive; use `listAllAccounts` to walk to
 *  the end. */
export async function listAccounts(
  options: ListAccountsOptions = {},
  { challenge }: ChallengeOption = {},
): Promise<{ accounts: Account[]; next_cursor: AccountCursor | null }> {
  const json = await call<{ accounts: Account[]; next_cursor: AccountCursor | null }>({
    service: "simple-email",
    path: "/accounts/list",
    body: {
      limit: options.limit,
      after_created_time_stamp: options.after_created_time_stamp,
      after_app_id: options.after_app_id,
    },
    challenge,
  });
  return { accounts: json.accounts, next_cursor: json.next_cursor };
}

export async function listAllAccounts(request: ChallengeOption = {}): Promise<Account[]> {
  return collectPages<Account, AccountCursor>(async (cursor) => {
    const page = await listAccounts({ limit: 100, ...(cursor ?? {}) }, request);
    return { rows: page.accounts, nextCursor: page.next_cursor };
  });
}

/** Returns the account plus its live operational state — the four extra
 *  fields are nullable siblings of `account`, not nested inside it. */
export async function accountInfo({ challenge }: ChallengeOption = {}): Promise<AccountInfoEnvelope> {
  const json = await call<AccountInfoEnvelope>({
    service: "simple-email",
    path: `/accounts/${requireAppId()}/info`,
    challenge,
  });
  return {
    account: json.account,
    daily_cap: json.daily_cap,
    sent_today: json.sent_today,
    credit_blocked: json.credit_blocked,
  };
}

export async function deleteAccount({ challenge }: ChallengeOption = {}): Promise<void> {
  await call<{ ok: true }>({ service: "simple-email", path: `/accounts/${requireAppId()}/delete`, challenge });
}

/** `replyTo` is REQUIRED and its key is always sent, even `null` — the
 *  server refuses a missing key with a 400, so a typo can never silently
 *  clear it. An address sets where recipients' replies go (every send from
 *  the account carries it as its `Reply-To`); `null` clears it. */
export async function setReplyTo(replyTo: string | null, { challenge }: ChallengeOption = {}): Promise<Account> {
  const json = await call<{ account: Account }>({
    service: "simple-email",
    path: `/accounts/${requireAppId()}/set_reply_to`,
    body: { reply_to: replyTo },
    challenge,
  });
  return json.account;
}

// ── Templates (nested under the account) ────────────────────────────────

/** Returns metadata only — no `html`. Use `templateInfo` to read the body
 *  back.
 *
 *  `name` is nullable because the service accepts a nameless template: pass
 *  an explicit `null`, and `TemplateMeta.name` comes back `null`. An
 *  omitted group is left off the wire (an empty group). */
export async function createTemplate(
  body: CreateTemplateBody,
  { challenge }: ChallengeOption = {},
): Promise<TemplateMeta> {
  const json = await call<{ template: TemplateMeta }>({
    service: "simple-email",
    path: `/accounts/${requireAppId()}/templates/create`,
    body,
    challenge,
  });
  return json.template;
}

/** The paged primitive; use `listAllTemplates` to walk to the end. Rows
 *  carry metadata only — no `html`. */
export async function listTemplates(
  options: ListTemplatesOptions = {},
  { challenge }: ChallengeOption = {},
): Promise<{ templates: TemplateMeta[]; next_cursor: TemplateCursor | null }> {
  const json = await call<{ templates: TemplateMeta[]; next_cursor: TemplateCursor | null }>({
    service: "simple-email",
    path: `/accounts/${requireAppId()}/templates/list`,
    body: {
      limit: options.limit,
      after_created_time_stamp: options.after_created_time_stamp,
      after_template_id: options.after_template_id,
    },
    challenge,
  });
  return { templates: json.templates, next_cursor: json.next_cursor };
}

export async function listAllTemplates(request: ChallengeOption = {}): Promise<TemplateMeta[]> {
  return collectPages<TemplateMeta, TemplateCursor>(async (cursor) => {
    const page = await listTemplates({ limit: 100, ...(cursor ?? {}) }, request);
    return { rows: page.templates, nextCursor: page.next_cursor };
  });
}

/** The only template route whose answer carries `html`. */
export async function templateInfo(templateNanoid: string, { challenge }: ChallengeOption = {}): Promise<Template> {
  const json = await call<{ template: Template }>({
    service: "simple-email",
    path: `/accounts/${requireAppId()}/templates/${templateNanoid}/info`,
    challenge,
  });
  return json.template;
}

/**
 * A FULL REPLACE of both `subject` and `html`; `recipient`, `send_group` and
 * `deny_group` change only when their key is sent. `name` is not updatable
 * at all. Returns metadata only, like `createTemplate`. An oversize body is
 * rejected by the server before any handler runs, so the thrown
 * `PilelyError` carries a null `code`.
 */
export async function updateTemplate(
  templateNanoid: string,
  body: UpdateTemplateBody,
  { challenge }: ChallengeOption = {},
): Promise<TemplateMeta> {
  const json = await call<{ template: TemplateMeta }>({
    service: "simple-email",
    path: `/accounts/${requireAppId()}/templates/${templateNanoid}/update`,
    body,
    challenge,
  });
  return json.template;
}

export async function deleteTemplate(templateNanoid: string, { challenge }: ChallengeOption = {}): Promise<void> {
  await call<{ ok: true }>({
    service: "simple-email",
    path: `/accounts/${requireAppId()}/templates/${templateNanoid}/delete`,
    challenge,
  });
}
