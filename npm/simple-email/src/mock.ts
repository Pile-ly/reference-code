// The in-browser fake of the simple_email service that `@pilely/core`'s
// mock runtime routes to in mock mode. It answers every route this
// package's wrapper calls with the JSON the real service returns. Nothing
// is ever sent: `send` appends to an in-memory outbox (the rows `listSends`
// answers) and logs the message to the console. Accounts and templates
// live in memory and persist through the core store; an app's account is
// created on its first send if it does not exist yet. It models shape, not
// policy: no send groups, `account_senders` gating, daily caps, phone gates
// or credit checks. It does model the send shapes (raw and account sends)
// and `idempotency_key`: a repeat with the same key, body and caller within
// 24 hours answers the first send with `replayed: true` and adds no row; the
// same key with another body or caller is `409 idempotency_key_reused`. An
// account send to `"self"` logs `recipients: []`, one to `"owner"` logs a
// stand-in owner address — the fake has no real account emails. Writes
// need a signed-in user; a signed-out write and a missing account or
// template answer the uniform bare 404. Reached only from the
// `isMockMode()` branch in index.ts, so a production build carries none of
// it.

import type { MockReply, MockServiceContext, MockServiceFactory } from "@pilely/core";

import type {
  Account,
  AccountCursor,
  AccountSenders,
  SendCursor,
  SendRow,
  TemplateCursor,
  TemplateMeta,
  ToAccount,
} from "./types.js";

const MARKER = "pilely-mock-fake:simple-email";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_RECIPIENTS = 50;
const DAILY_CAP = 200;
const SENDING_DOMAIN = "mail.pilely.invalid";
const ACCOUNT_EMAIL_DOMAIN = "account.pilely.invalid";
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,128}$/;
const ACCOUNT_SENDERS: readonly AccountSenders[] = ["send_group", "app_users"];
const TO_ACCOUNT: readonly ToAccount[] = ["self", "owner"];

interface TemplateState extends TemplateMeta {
  html: string;
}

interface AccountState extends Account {
  templates: TemplateState[];
}

/** A send-log row plus what the fake keeps off the wire: its app, and the
 *  request fingerprint a keyed repeat is compared against. */
type SendState = SendRow & { app_id: string; fingerprint?: string };

interface State {
  accounts: AccountState[];
  sends: SendState[];
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

function render(text: string, variables: Record<string, unknown>): string {
  return text.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (whole, name: string) =>
    name in variables ? String(variables[name]) : whole,
  );
}

function accountPayload(account: AccountState): Account {
  return {
    app_id: account.app_id,
    address: account.address,
    display_name: account.display_name,
    send_group: account.send_group,
    // State persisted before account_senders existed reads the default.
    account_senders: account.account_senders ?? "send_group",
    created_time_stamp: account.created_time_stamp,
  };
}

/** The wire row: the fake's own fields stripped, and the two newer keys
 *  defaulted for rows persisted before they existed. */
function sendPayload({ app_id: _appId, fingerprint: _fingerprint, ...row }: SendState): SendRow {
  return { ...row, to_account: row.to_account ?? null, idempotency_key: row.idempotency_key ?? null };
}

/** `undefined` when the key is absent; `null` when it is present but not
 *  one of the two values (an explicit `null` included — the server's 400). */
function parseAccountSenders(body: Record<string, unknown>): AccountSenders | undefined | null {
  if (!("account_senders" in body)) return undefined;
  const value = body.account_senders;
  return ACCOUNT_SENDERS.includes(value as AccountSenders) ? (value as AccountSenders) : null;
}

/** The service's "same body": the caller, the mode, `to` as a
 *  case-insensitive set, `to_account`, the template and its variables, and
 *  inline content. */
function fingerprint(caller: string, body: Record<string, unknown>, to: string[] | null): string {
  const variables = isObject(body.variables)
    ? Object.keys(body.variables)
        .sort()
        .map((name) => [name, (body.variables as Record<string, unknown>)[name]])
    : null;
  return JSON.stringify([
    caller,
    body.app_id,
    to === null ? null : [...new Set(to.map((r) => r.toLowerCase()))].sort(),
    body.to_account ?? null,
    body.template_id ?? null,
    variables,
    body.subject ?? null,
    body.html ?? null,
  ]);
}

function templateMeta(template: TemplateState): TemplateMeta {
  return {
    template_id: template.template_id,
    name: template.name,
    subject: template.subject,
    created_time_stamp: template.created_time_stamp,
    updated_time_stamp: template.updated_time_stamp,
  };
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

  function createAccount(appId: string, sendGroup: string | null, accountSenders: AccountSenders): AccountState {
    const account: AccountState = {
      app_id: appId,
      address: `${appId}@${SENDING_DOMAIN}`,
      display_name: null,
      send_group: sendGroup,
      account_senders: accountSenders,
      created_time_stamp: ctx.now(),
      templates: [],
    };
    state.accounts.push(account);
    return account;
  }

  function send(body: Record<string, unknown>): MockReply {
    if (typeof body.app_id !== "string" || body.app_id === "") {
      return ctx.refuse(400, "bad_request", "app_id is required");
    }
    const hasTo = body.to !== undefined && body.to !== null;
    const hasToAccount = body.to_account !== undefined && body.to_account !== null;
    if (hasTo === hasToAccount) {
      return ctx.refuse(400, "bad_request", "send either to or to_account");
    }
    let to: string[] | null = null;
    let toAccount: ToAccount | null = null;
    if (hasTo) {
      const raw = body.to;
      if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_RECIPIENTS || !raw.every((r) => typeof r === "string")) {
        return ctx.refuse(400, "bad_request", `to must hold 1..=${MAX_RECIPIENTS} addresses`);
      }
      to = raw as string[];
    } else {
      if (!TO_ACCOUNT.includes(body.to_account as ToAccount)) {
        return ctx.refuse(400, "bad_request", 'to_account must be "self" or "owner"');
      }
      toAccount = body.to_account as ToAccount;
    }
    const hasTemplate = body.template_id !== undefined && body.template_id !== null;
    const hasInline = body.subject !== undefined || body.html !== undefined;
    if (toAccount !== null && (hasInline || !hasTemplate)) {
      return ctx.refuse(400, "bad_request", "an account send takes template_id, never subject or html");
    }
    if (hasTemplate === hasInline) {
      return ctx.refuse(400, "bad_request", "send either template_id or subject + html");
    }
    const key = body.idempotency_key;
    if (key !== undefined && (typeof key !== "string" || !IDEMPOTENCY_KEY.test(key))) {
      return ctx.refuse(400, "bad_request", "idempotency_key must be 1..=128 characters of [A-Za-z0-9._:-]");
    }
    const account = findAccount(body.app_id) ?? createAccount(body.app_id, null, "send_group");
    const user = ctx.user();
    const caller = user?.id ?? "mock-user";
    const print = fingerprint(caller, body, to);

    const now = ctx.now();
    if (typeof key === "string") {
      const first = state.sends.find(
        (s) => s.app_id === account.app_id && s.idempotency_key === key && now - s.fired_at < IDEMPOTENCY_WINDOW_MS,
      );
      if (first) {
        if (first.fingerprint !== print) {
          return ctx.refuse(409, "idempotency_key_reused", "this idempotency_key belongs to a different request");
        }
        return ctx.ok({ ok: true, send_id: first.send_id, recipient_count: first.recipient_count, replayed: true });
      }
    }

    let subject: string;
    let html: string;
    let templateId: string | null = null;
    if (hasTemplate) {
      const template = account.templates.find((t) => t.template_id === body.template_id);
      if (!template) {
        return ctx.refuse(400, "bad_request", "template_id names no template of this account");
      }
      const variables = isObject(body.variables) ? body.variables : {};
      subject = render(template.subject, variables);
      html = render(template.html, variables);
      templateId = template.template_id;
    } else {
      if (typeof body.subject !== "string" || typeof body.html !== "string") {
        return ctx.refuse(400, "bad_request", "subject and html are required together");
      }
      subject = body.subject;
      html = body.html;
    }

    // A "self" row never shows the caller's address; an "owner" row shows the
    // owner's own. The fake has no account emails, so the owner's is a
    // stand-in built from the signed-in mock user's handle.
    const recipients =
      to !== null ? [...to] : toAccount === "owner" ? [`${user?.handle ?? "owner"}@${ACCOUNT_EMAIL_DOMAIN}`] : [];
    const row: SendState = {
      app_id: account.app_id,
      fingerprint: print,
      send_id: ctx.nanoid(),
      requester_user_id: caller,
      via_app: true,
      kind: hasTemplate ? "template" : "inline",
      template_id: templateId,
      subject,
      recipients,
      recipient_count: to !== null ? to.length : 1,
      outcome: "sent",
      outcome_reason: null,
      to_account: toAccount,
      idempotency_key: typeof key === "string" ? key : null,
      fired_at: now,
    };
    state.sends.push(row);
    save();
    console.log("[pilely mock] simple-email outbox: nothing was sent", {
      from: account.address,
      to: toAccount !== null ? `(the ${toAccount === "self" ? "caller's" : "owner's"} account email)` : row.recipients,
      subject,
      html,
    });
    return ctx.ok({ ok: true, send_id: row.send_id, recipient_count: row.recipient_count, replayed: false });
  }

  function handle(path: string, rawBody: unknown): MockReply | null {
    const body = isObject(rawBody) ? rawBody : {};
    const signedIn = ctx.user() !== null;

    if (path === "/send") {
      if (!signedIn) return ctx.notFound();
      return send(body);
    }

    if (path === "/sends/list") {
      const appId = typeof body.app_id === "string" ? body.app_id : "";
      const rows = state.sends.filter((s) => s.app_id === appId);
      const result = keysetPage(
        rows,
        body,
        ["after_created_time_stamp", "after_send_id"],
        (s) => [s.fired_at, s.send_id],
        (s): SendCursor => ({ after_created_time_stamp: s.fired_at, after_send_id: s.send_id }),
      );
      if (!result) return cursorRefusal();
      const sends = result.page.map(sendPayload);
      return ctx.ok({ ok: true, sends, next_cursor: result.next });
    }

    if (path === "/accounts/create") {
      if (!signedIn) return ctx.notFound();
      if (typeof body.app_id !== "string" || body.app_id === "") {
        return ctx.refuse(400, "bad_request", "app_id is required");
      }
      if (findAccount(body.app_id)) {
        return ctx.refuse(409, "account_exists", "this app already has an email account");
      }
      const accountSenders = parseAccountSenders(body);
      if (accountSenders === null) {
        return ctx.refuse(400, "bad_request", 'account_senders must be "send_group" or "app_users"');
      }
      const sendGroup = typeof body.send_group === "string" ? body.send_group : null;
      const account = createAccount(body.app_id, sendGroup, accountSenders ?? "send_group");
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
        phone_verified: true,
      });
    }
    if (route === "delete") {
      if (!signedIn || !account) return ctx.notFound();
      state.accounts = state.accounts.filter((a) => a !== account);
      save();
      return ctx.ok({ ok: true });
    }
    if (route === "access/set") {
      if (!signedIn || !account) return ctx.notFound();
      if (!("send_group" in body)) return ctx.refuse(400, "bad_request", "send_group is required");
      const accountSenders = parseAccountSenders(body);
      if (accountSenders === null) {
        return ctx.refuse(400, "bad_request", 'account_senders must be "send_group" or "app_users"');
      }
      account.send_group = typeof body.send_group === "string" ? body.send_group : null;
      // Omitted keeps the current value.
      if (accountSenders !== undefined) account.account_senders = accountSenders;
      save();
      return ctx.ok({ ok: true, account: accountPayload(account) });
    }
    if (route === "templates/create") {
      if (!signedIn || !account) return ctx.notFound();
      if (typeof body.subject !== "string" || typeof body.html !== "string") {
        return ctx.refuse(400, "bad_request", "subject and html are required");
      }
      const now = ctx.now();
      const template: TemplateState = {
        template_id: ctx.nanoid(),
        name: typeof body.name === "string" ? body.name : null,
        subject: body.subject,
        html: body.html,
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
    if (action === "info") {
      if (!template) return ctx.notFound();
      return ctx.ok({ ok: true, template: { ...templateMeta(template), html: template.html } });
    }
    if (action === "update") {
      if (!signedIn || !template) return ctx.notFound();
      if (typeof body.subject !== "string" || typeof body.html !== "string") {
        return ctx.refuse(400, "bad_request", "subject and html are both required");
      }
      template.subject = body.subject;
      template.html = body.html;
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
