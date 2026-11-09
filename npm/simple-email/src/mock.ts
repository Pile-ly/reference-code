// The in-browser fake of the simple_email service that `@pilely/core`'s
// mock runtime routes to in mock mode. It answers every route this
// package's page-side functions call with the JSON the real service
// returns. Nothing is ever sent: a template send appends to an in-memory
// outbox, carrying the template's stored recipient, and logs the message to
// the console; its answer is `{ ok, send_id }` and never the address.
// Accounts and templates live in memory and persist through the core store.
//
// The template send admits callers by the template's groups the way the
// simple-db fake admits by policies: an empty `send_group` admits nobody;
// the two platform-wide groups hold callers by type (every signed-out
// visitor is in the anonymous group, every signed-in person — the owner
// included — in the authenticated group), named by the same fixed test ids
// the simple-group fake answers; the fake has no group membership data, so
// ANY OTHER GROUP HOLDS NOBODY — an owner group as `send_group` admits no
// one and a `deny_group` denies no one. Every refused caller gets the
// uniform bare 404. Each placeholder of the template is read from the body
// field of the same name; a missing or non-string one is `400 bad_request`
// and nothing lands in the outbox; every other field is ignored.
//
// The freestyle send (`accounts/{app_id}/send`) answers the uniform bare
// 404 to every caller: the service admits only the app's backend there, and
// no caller in a browser is one. `send()` itself never reaches this fake —
// it is a server function that calls `fetch` directly.
//
// Owner writes need a signed-in user; a signed-out write and a missing
// account or template answer the uniform bare 404. Accounts carry
// `reply_to`, set on create and by `set_reply_to` (key required, a string
// or `null`); templates carry `recipient` (required on create), `send_group`
// and `deny_group` (a platform-wide group as `deny_group` is the service's
// 400). The fake checks the fields' shapes, not the address rules, refused
// domains or group ownership. It does not model the daily caps, rate
// limits or credit checks. Reached only from the `isMockMode()` branch in
// api.ts, so a production build carries none of it.

import type { MockReply, MockServiceContext, MockServiceFactory } from "@pilely/core";

import type { Account, AccountCursor, TemplateCursor, TemplateMeta } from "./types.js";

const MARKER = "pilely-mock-fake:simple-email";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const DAILY_CAP = 200;
const SENDING_DOMAIN = "mail.pilely.invalid";
const VARIABLES_MAX_BYTES = 4096;
const GROUP_ID = /^[A-Za-z0-9]{1,64}$/;
const ADDRESS = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** The fake's ids for the two platform-wide groups: fixed test values, not
 *  the production ids. `@pilely/simple-group`'s fake answers the same two
 *  from `groups/anonymous` and `groups/authenticated`, so in mock mode an id
 *  read from `anonymousGroupId()` / `authenticatedGroupId()` works as a
 *  template's `send_group` here. Not part of the package's public surface. */
export const MOCK_ANON_GROUP = "mockAnonymousGroup0001";
export const MOCK_AUTH_GROUP = "mockAuthenticatedGrp01";

/** A template persisted before the template-send fields existed reads this
 *  recipient, the stand-in for the owner's account email the service's
 *  migration stored. */
const LEGACY_RECIPIENT = "owner@account.pilely.invalid";

interface TemplateState {
  template_id: string;
  name: string | null;
  subject: string;
  html: string;
  /** Optional only for state persisted before these fields existed. */
  recipient?: string;
  send_group?: string | null;
  deny_group?: string | null;
  created_time_stamp: number;
  updated_time_stamp: number;
}

interface AccountState extends Account {
  templates: TemplateState[];
}

/** One outbox entry: a template send, to the template's stored recipient. */
interface OutboxRow {
  app_id: string;
  send_id: string;
  template_id: string;
  recipient: string;
  subject: string;
  recipient_count: number;
  fired_at: number;
}

interface State {
  accounts: AccountState[];
  sends: OutboxRow[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compare(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function pageSize(body: Record<string, unknown>): number {
  const raw = body.limit === undefined || body.limit === null ? DEFAULT_PAGE_SIZE : Number(body.limit);
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isFinite(raw) ? Math.trunc(raw) : DEFAULT_PAGE_SIZE));
}

/** Every placeholder name in `text`, in order of first use. */
function placeholders(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1] as string))];
}

function render(text: string, values: Record<string, string>): string {
  return text.replace(PLACEHOLDER, (whole, name: string) => (name in values ? (values[name] as string) : whole));
}

function accountPayload(account: AccountState): Account {
  // Built field by field, so state persisted with fields the service no
  // longer answers never reaches the wire.
  return {
    app_id: account.app_id,
    address: account.address,
    display_name: account.display_name,
    // State persisted before reply_to existed reads none.
    reply_to: account.reply_to ?? null,
    created_time_stamp: account.created_time_stamp,
  };
}

function templateMeta(template: TemplateState): TemplateMeta {
  return {
    template_id: template.template_id,
    name: template.name,
    subject: template.subject,
    recipient: template.recipient ?? LEGACY_RECIPIENT,
    send_group: template.send_group ?? null,
    deny_group: template.deny_group ?? null,
    created_time_stamp: template.created_time_stamp,
    updated_time_stamp: template.updated_time_stamp,
  };
}

/** `undefined` when the key is absent; the address, or `null` (none). A value
 *  of any other type is the server's 400, answered as `false`. */
function parseReplyTo(body: Record<string, unknown>): string | null | undefined | false {
  if (!("reply_to" in body)) return undefined;
  const value = body.reply_to;
  if (value === null || typeof value === "string") return value;
  return false;
}

/** `undefined` when the key is absent; the group id, or `null` (empty). A
 *  value that is not a group id is the server's 400, answered as `false`. */
function parseGroup(body: Record<string, unknown>, key: "send_group" | "deny_group"): string | null | undefined | false {
  if (!(key in body)) return undefined;
  const value = body[key];
  if (value === null) return null;
  if (typeof value === "string" && GROUP_ID.test(value)) return value;
  return false;
}

/** Whether `group` holds the caller: the anonymous group every signed-out
 *  visitor, the authenticated group every signed-in person; the fake has no
 *  membership data, so any other group holds nobody. */
function groupHolds(group: string | null, signedIn: boolean): boolean {
  if (group === MOCK_ANON_GROUP) return !signedIn;
  if (group === MOCK_AUTH_GROUP) return signedIn;
  return false;
}

/**
 * Newest-first keyset paging over rows already sorted, with the cursor
 * taken from the last row whenever the page is full — the service's rule.
 */
function keysetPage<T, C>(
  rows: T[],
  body: Record<string, unknown>,
  keys: [string, string],
  key: (row: T) => [number, string],
  cursor: (row: T) => C,
): { page: T[]; next: C | null } | null {
  const [msKey, idKey] = keys;
  const hasMs = body[msKey] !== undefined && body[msKey] !== null;
  const hasId = body[idKey] !== undefined && body[idKey] !== null;
  if (hasMs !== hasId) return null;
  const limit = pageSize(body);
  let sorted = [...rows].sort((a, b) => {
    const [am, ai] = key(a);
    const [bm, bi] = key(b);
    return compare(bm, am) || compare(bi, ai);
  });
  if (hasMs) {
    const afterMs = Number(body[msKey]);
    const afterId = String(body[idKey]);
    sorted = sorted.filter((row) => {
      const [ms, id] = key(row);
      return ms < afterMs || (ms === afterMs && id < afterId);
    });
  }
  const page = sorted.slice(0, limit);
  const last = page[page.length - 1];
  return { page, next: page.length === limit && last ? cursor(last) : null };
}

export const createSimpleEmailFake: MockServiceFactory = (ctx: MockServiceContext) => {
  const state: State = ctx.load<State>() ?? { accounts: [], sends: [] };
  const save = () => ctx.save(state);
  const cursorRefusal = () => ctx.refuse(400, "bad_request", "cursor needs BOTH keys or neither");

  function findAccount(appId: string): AccountState | undefined {
    return state.accounts.find((a) => a.app_id === appId);
  }

  /** The two groups of a create or update body, or the server's 400. Each
   *  is `undefined` when its key is absent. */
  function parseGroups(
    body: Record<string, unknown>,
  ): { send_group: string | null | undefined; deny_group: string | null | undefined } | MockReply {
    const sendGroup = parseGroup(body, "send_group");
    const denyGroup = parseGroup(body, "deny_group");
    if (sendGroup === false || denyGroup === false) {
      return ctx.refuse(400, "bad_request", "send_group and deny_group must be a group id (1..=64 of [A-Za-z0-9]) or null");
    }
    if (denyGroup === MOCK_ANON_GROUP || denyGroup === MOCK_AUTH_GROUP) {
      return ctx.refuse(400, "bad_request", "deny_group must be an ACTIVE simple_group owned by you, or null");
    }
    return { send_group: sendGroup, deny_group: denyGroup };
  }

  /** The template send: the caller and the template's groups, then the
   *  body, then the outbox. */
  function sendTemplate(account: AccountState | undefined, template: TemplateState | undefined, rawBody: unknown): MockReply {
    const signedIn = ctx.user() !== null;
    if (!account || !template) return ctx.notFound();
    const sendGroup = template.send_group ?? null;
    if (!groupHolds(sendGroup, signedIn)) return ctx.notFound();
    // A deny_group is an owner group, and an owner group holds nobody here.

    if (rawBody !== undefined && rawBody !== null && !isObject(rawBody)) {
      return ctx.refuse(400, "bad_request", "the body must be a JSON object of the template's variables");
    }
    const body = isObject(rawBody) ? rawBody : {};
    const values: Record<string, string> = {};
    for (const name of placeholders(`${template.subject}\n${template.html}`)) {
      const value = body[name];
      if (typeof value !== "string") {
        return ctx.refuse(400, "bad_request", `template variable ${name} is missing or not a string`);
      }
      values[name] = value;
    }
    if (new TextEncoder().encode(Object.values(values).join("")).length > VARIABLES_MAX_BYTES) {
      return ctx.refuse(400, "bad_request", `the template's values exceed ${VARIABLES_MAX_BYTES} bytes`);
    }

    const recipient = template.recipient ?? LEGACY_RECIPIENT;
    const subject = render(template.subject, values);
    const html = render(template.html, values);
    const row: OutboxRow = {
      app_id: account.app_id,
      send_id: ctx.nanoid(),
      template_id: template.template_id,
      recipient,
      subject,
      recipient_count: 1,
      fired_at: ctx.now(),
    };
    state.sends.push(row);
    save();
    console.log("[pilely mock] simple-email outbox: nothing was sent", {
      from: account.address,
      to: recipient,
      subject,
      html,
    });
    return ctx.ok({ ok: true, send_id: row.send_id });
  }

  function handle(path: string, rawBody: unknown): MockReply | null {
    const body = isObject(rawBody) ? rawBody : {};
    const signedIn = ctx.user() !== null;

    if (path === "/accounts/create") {
      if (!signedIn) return ctx.notFound();
      if (typeof body.app_id !== "string" || body.app_id === "") {
        return ctx.refuse(400, "bad_request", "app_id is required");
      }
      if (findAccount(body.app_id)) {
        return ctx.refuse(409, "account_exists", "this app already has an email account");
      }
      const replyTo = parseReplyTo(body);
      if (replyTo === false) {
        return ctx.refuse(400, "bad_request", "reply_to must be an email address or null");
      }
      const account: AccountState = {
        app_id: body.app_id,
        address: `${body.app_id}@${SENDING_DOMAIN}`,
        display_name: null,
        reply_to: replyTo ?? null,
        created_time_stamp: ctx.now(),
        templates: [],
      };
      state.accounts.push(account);
      save();
      return ctx.ok({ ok: true, account: accountPayload(account) });
    }

    if (path === "/accounts/list") {
      const result = keysetPage(
        state.accounts,
        body,
        ["after_created_time_stamp", "after_app_id"],
        (a) => [a.created_time_stamp, a.app_id],
        (a): AccountCursor => ({ after_created_time_stamp: a.created_time_stamp, after_app_id: a.app_id }),
      );
      if (!result) return cursorRefusal();
      return ctx.ok({ ok: true, accounts: result.page.map(accountPayload), next_cursor: result.next });
    }

    const parts = path.split("/").filter((p) => p !== "").map(decodeURIComponent);
    if (parts[0] !== "accounts" || parts[1] === undefined) return null;
    const account = findAccount(parts[1]);
    const rest = parts.slice(2);
    const route = rest.join("/");

    if (route === "send") {
      // Only the app's backend may make a freestyle send; no browser caller is one.
      return ctx.notFound();
    }
    if (route === "info") {
      if (!account) return ctx.notFound();
      const today = new Date().toISOString().slice(0, 10);
      const sentToday = state.sends
        .filter((s) => s.app_id === account.app_id && new Date(s.fired_at).toISOString().slice(0, 10) === today)
        .reduce((sum, s) => sum + s.recipient_count, 0);
      return ctx.ok({
        ok: true,
        account: accountPayload(account),
        daily_cap: DAILY_CAP,
        sent_today: sentToday,
        credit_blocked: false,
      });
    }
    if (route === "delete") {
      if (!signedIn || !account) return ctx.notFound();
      state.accounts = state.accounts.filter((a) => a !== account);
      save();
      return ctx.ok({ ok: true });
    }
    if (route === "set_reply_to") {
      if (!signedIn || !account) return ctx.notFound();
      const replyTo = parseReplyTo(body);
      if (replyTo === undefined) {
        return ctx.refuse(400, "bad_request", "reply_to is required (an email address, or null to clear it)");
      }
      if (replyTo === false) {
        return ctx.refuse(400, "bad_request", "reply_to must be an email address or null");
      }
      account.reply_to = replyTo;
      save();
      return ctx.ok({ ok: true, account: accountPayload(account) });
    }
    if (route === "templates/create") {
      if (!signedIn || !account) return ctx.notFound();
      if (typeof body.subject !== "string" || typeof body.html !== "string") {
        return ctx.refuse(400, "bad_request", "subject and html are required");
      }
      if (typeof body.recipient !== "string" || !ADDRESS.test(body.recipient)) {
        return ctx.refuse(400, "bad_request", "recipient is required: one email address");
      }
      const groups = parseGroups(body);
      if ("status" in groups) return groups;
      const now = ctx.now();
      const template: TemplateState = {
        template_id: ctx.nanoid(),
        name: typeof body.name === "string" ? body.name : null,
        subject: body.subject,
        html: body.html,
        recipient: body.recipient,
        send_group: groups.send_group ?? null,
        deny_group: groups.deny_group ?? null,
        created_time_stamp: now,
        updated_time_stamp: now,
      };
      account.templates.push(template);
      save();
      return ctx.ok({ ok: true, template: templateMeta(template) });
    }
    if (route === "templates/list") {
      if (!account) return ctx.notFound();
      const result = keysetPage(
        account.templates,
        body,
        ["after_created_time_stamp", "after_template_id"],
        (t) => [t.created_time_stamp, t.template_id],
        (t): TemplateCursor => ({ after_created_time_stamp: t.created_time_stamp, after_template_id: t.template_id }),
      );
      if (!result) return cursorRefusal();
      return ctx.ok({ ok: true, templates: result.page.map(templateMeta), next_cursor: result.next });
    }

    if (rest[0] !== "templates" || rest[1] === undefined || rest.length !== 3) return null;
    const template = account?.templates.find((t) => t.template_id === rest[1]);
    const action = rest[2];
    if (action === "send") {
      return sendTemplate(account, template, rawBody);
    }
    if (action === "info") {
      if (!template) return ctx.notFound();
      return ctx.ok({ ok: true, template: { ...templateMeta(template), html: template.html } });
    }
    if (action === "update") {
      if (!signedIn || !template) return ctx.notFound();
      if (typeof body.subject !== "string" || typeof body.html !== "string") {
        return ctx.refuse(400, "bad_request", "subject and html are both required");
      }
      if ("recipient" in body && (typeof body.recipient !== "string" || !ADDRESS.test(body.recipient))) {
        return ctx.refuse(400, "bad_request", "recipient must be one email address; it cannot be emptied");
      }
      const groups = parseGroups(body);
      if ("status" in groups) return groups;
      template.subject = body.subject;
      template.html = body.html;
      // An omitted key keeps the stored value; null empties a group.
      if (typeof body.recipient === "string") template.recipient = body.recipient;
      if (groups.send_group !== undefined) template.send_group = groups.send_group;
      if (groups.deny_group !== undefined) template.deny_group = groups.deny_group;
      template.updated_time_stamp = ctx.now();
      save();
      return ctx.ok({ ok: true, template: templateMeta(template) });
    }
    if (action === "delete") {
      if (!signedIn || !account || !template) return ctx.notFound();
      account.templates = account.templates.filter((t) => t !== template);
      save();
      return ctx.ok({ ok: true });
    }
    return null;
  }

  return { marker: MARKER, handle: (request) => handle(request.path, request.body) };
};
