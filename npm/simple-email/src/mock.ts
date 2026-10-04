// The in-browser fake of the simple_email service that `@pilely/core`'s
// mock runtime routes to in mock mode. It answers every route this
// package's wrapper calls with the JSON the real service returns. Nothing
// is ever sent: `send` appends to an in-memory outbox (the rows `listSends`
// answers) and logs the message to the console. Accounts and templates
// live in memory and persist through the core store; an app's account is
// created on its first send if it does not exist yet. It models shape, not
// policy: no send groups, daily caps, phone gates or credit checks. Writes
// need a signed-in user; a signed-out write and a missing account or
// template answer the uniform bare 404. Reached only from the
// `isMockMode()` branch in index.ts, so a production build carries none of
// it.

import type { MockReply, MockServiceContext, MockServiceFactory } from "@pilely/core";

import type { Account, AccountCursor, SendCursor, SendRow, TemplateCursor, TemplateMeta } from "./types.js";

const MARKER = "pilely-mock-fake:simple-email";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_RECIPIENTS = 50;
const DAILY_CAP = 200;
const SENDING_DOMAIN = "mail.pilely.invalid";

interface TemplateState extends TemplateMeta {
  html: string;
}

interface AccountState extends Account {
  templates: TemplateState[];
}

interface State {
  accounts: AccountState[];
  sends: (SendRow & { app_id: string })[];
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
    created_time_stamp: account.created_time_stamp,
  };
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

  function createAccount(appId: string, sendGroup: string | null): AccountState {
    const account: AccountState = {
      app_id: appId,
      address: `${appId}@${SENDING_DOMAIN}`,
      display_name: null,
      send_group: sendGroup,
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
    const to = body.to;
    if (!Array.isArray(to) || to.length < 1 || to.length > MAX_RECIPIENTS || !to.every((r) => typeof r === "string")) {
      return ctx.refuse(400, "bad_request", `to must hold 1..=${MAX_RECIPIENTS} addresses`);
    }
    const hasTemplate = body.template_id !== undefined && body.template_id !== null;
    const hasInline = body.subject !== undefined || body.html !== undefined;
    if (hasTemplate === hasInline) {
      return ctx.refuse(400, "bad_request", "send either template_id or subject + html");
    }
    const account = findAccount(body.app_id) ?? createAccount(body.app_id, null);

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

    const now = ctx.now();
    const row: SendRow & { app_id: string } = {
      app_id: account.app_id,
      send_id: ctx.nanoid(),
      requester_user_id: ctx.user()?.id ?? "mock-user",
      via_app: true,
      kind: hasTemplate ? "template" : "inline",
      template_id: templateId,
      subject,
      recipients: [...to],
      recipient_count: to.length,
      outcome: "sent",
      outcome_reason: null,
      fired_at: now,
    };
    state.sends.push(row);
    save();
    console.log("[pilely mock] simple-email outbox: nothing was sent", {
      from: account.address,
      to: row.recipients,
      subject,
      html,
    });
    return ctx.ok({ ok: true, send_id: row.send_id, recipient_count: row.recipient_count });
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
      const sends = result.page.map(({ app_id: _appId, ...row }) => row);
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
      const sendGroup = typeof body.send_group === "string" ? body.send_group : null;
      const account = createAccount(body.app_id, sendGroup);
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
      account.send_group = typeof body.send_group === "string" ? body.send_group : null;
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
