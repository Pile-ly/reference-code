import { afterEach, describe, expect, it, vi } from "vitest";
import type { PilelyClient } from "@pilely/core";
import {
  accountInfo,
  createAccount,
  createTemplate,
  deleteAccount,
  deleteTemplate,
  listAccounts,
  listAllAccounts,
  listAllTemplates,
  listTemplates,
  sendTemplate,
  setReplyTo,
  templateInfo,
  updateTemplate,
} from "./api.js";
import type { CreateTemplateBody, UpdateTemplateBody } from "./api.js";
import type { SimpleEmailErrorCode } from "./types.js";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function stubWindow(fetchImpl: PilelyClient["fetch"]): void {
  const client: PilelyClient = {
    ready: Promise.resolve(true),
    isAppOrigin: () => true,
    apexOrigin: () => "https://pilely.app",
    authOrigin: () => "https://auth.pilely.app",
    user: () => null,
    claims: () => null,
    token: () => null,
    fetch: fetchImpl,
    appId: () => "app-1",
    signIn: vi.fn(),
    signOut: vi.fn(),
    takeReturnPath: () => null,
  };
  (globalThis as { window?: unknown }).window = { pilely: client };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

function urlOf(fetchImpl: ReturnType<typeof vi.fn>): string {
  return String(fetchImpl.mock.calls[0]?.[0]);
}

function bodyOf(fetchImpl: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(init.body as string);
}

const base = "https://simple-email.pilely.app";
const accountBase = `${base}/accounts/app-1`;

const templateRow = {
  template_id: "t1",
  name: "n",
  subject: "s",
  recipient: "me@x.test",
  send_group: "g1",
  deny_group: null,
  created_time_stamp: 1,
  updated_time_stamp: 1,
};

const stubEnvelope = {
  ok: true,
  send_id: "s1",
  account: {
    app_id: "app-1",
    address: "a@x.test",
    display_name: null,
    reply_to: null,
    created_time_stamp: 1,
  },
  accounts: [],
  daily_cap: 100,
  sent_today: 0,
  credit_blocked: false,
  template: { ...templateRow, html: "<p/>" },
  templates: [],
  next_cursor: null,
};

const newTemplate: CreateTemplateBody = { name: "n", subject: "s", html: "<p/>", recipient: "me@x.test" };

describe("simple-email: every route maps to the correct URL", () => {
  const cases: [string, () => Promise<unknown>, string][] = [
    ["sendTemplate", () => sendTemplate("t1", { name: "Ada" }), `${accountBase}/templates/t1/send`],
    ["createAccount", () => createAccount(), `${base}/accounts/create`],
    ["listAccounts", () => listAccounts(), `${base}/accounts/list`],
    ["accountInfo", () => accountInfo(), `${accountBase}/info`],
    ["deleteAccount", () => deleteAccount(), `${accountBase}/delete`],
    ["setReplyTo", () => setReplyTo(null), `${accountBase}/set_reply_to`],
    ["createTemplate", () => createTemplate(newTemplate), `${accountBase}/templates/create`],
    ["listTemplates", () => listTemplates(), `${accountBase}/templates/list`],
    ["templateInfo", () => templateInfo("t1"), `${accountBase}/templates/t1/info`],
    [
      "updateTemplate",
      () => updateTemplate("t1", { subject: "s", html: "<p/>" }),
      `${accountBase}/templates/t1/update`,
    ],
    ["deleteTemplate", () => deleteTemplate("t1"), `${accountBase}/templates/t1/delete`],
  ];

  it.each(cases)("%s hits the correct path, with the /accounts/{app_id}/ prefix intact where expected", async (_name, run, expectedUrl) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
    stubWindow(fetchImpl);
    await run();
    expect(urlOf(fetchImpl)).toBe(expectedUrl);
  });

  it("covers all 11 page-side routes (the freestyle send is send.ts's)", () => {
    expect(cases).toHaveLength(11);
  });
});

describe("app_id: in the path everywhere but accounts/create and accounts/list", () => {
  it("accountInfo and template methods carry app_id in the path, not the body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
    stubWindow(fetchImpl);
    await accountInfo();
    expect(urlOf(fetchImpl)).toContain("/accounts/app-1/");
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.body ? JSON.parse(init.body as string) : {}).not.toHaveProperty("app_id");
  });
});

describe("sendTemplate", () => {
  it("posts the variables as the body to the template send path, with the page's own app id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, send_id: "s1" }));
    stubWindow(fetchImpl);
    const result = await sendTemplate("t1", { name: "Ada", message: "Hello!" });
    expect(urlOf(fetchImpl)).toBe("https://simple-email.pilely.app/accounts/app-1/templates/t1/send");
    expect(bodyOf(fetchImpl)).toEqual({ name: "Ada", message: "Hello!" });
    expect(result).toEqual({ send_id: "s1" });
  });

  it("sends {} for a template without placeholders", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, send_id: "s1" }));
    stubWindow(fetchImpl);
    await sendTemplate("t1");
    expect(bodyOf(fetchImpl)).toEqual({});
  });

  it("answers only the send id, even when the server answer carries more", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ok: true, send_id: "s1", recipient: "me@x.test" }));
    stubWindow(fetchImpl);
    expect(await sendTemplate("t1")).toEqual({ send_id: "s1" });
  });

  it("variables are strings only", () => {
    // @ts-expect-error a number is the server's 400
    void (() => sendTemplate("t1", { count: 3 }));
  });

  it("reads the refusals with their codes: 400 missing variable, 404 refused, 429 cap or limiter", async () => {
    for (const [status, code] of [
      [400, "bad_request"],
      [429, "daily_cap_exceeded"],
      [429, "rate_limited"],
    ] as [number, SimpleEmailErrorCode][]) {
      stubWindow(vi.fn().mockResolvedValue(jsonResponse(status, { ok: false, code, reason: "r" })));
      await expect(sendTemplate("t1", {})).rejects.toMatchObject({ status, code });
    }
    stubWindow(vi.fn().mockResolvedValue(jsonResponse(404, { ok: false, code: "not_found", reason: "r" })));
    await expect(sendTemplate("t1", {})).rejects.toMatchObject({ status: 404, code: "not_found" });
  });
});

describe("setReplyTo", () => {
  it("sends the address as reply_to and reads it back on the account", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { ok: true, account: { ...stubEnvelope.account, reply_to: "support@shop.example" } }),
    );
    stubWindow(fetchImpl);
    const account = await setReplyTo("support@shop.example");
    expect(urlOf(fetchImpl)).toBe(`${accountBase}/set_reply_to`);
    expect(bodyOf(fetchImpl)).toEqual({ reply_to: "support@shop.example" });
    expect(account.reply_to).toBe("support@shop.example");
  });

  it("emits reply_to even when null — the server refuses a missing key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
    stubWindow(fetchImpl);
    const account = await setReplyTo(null);
    const body = bodyOf(fetchImpl);
    expect(body).toEqual({ reply_to: null });
    expect(Object.keys(body)).toContain("reply_to");
    expect(account.reply_to).toBeNull();
  });

  it("requires its argument", () => {
    // @ts-expect-error the key is required on the wire, so the argument is too
    void (() => setReplyTo());
  });
});

describe("createAccount", () => {
  it("sends only app_id when no reply_to is given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
    stubWindow(fetchImpl);
    const account = await createAccount();
    expect(bodyOf(fetchImpl)).toEqual({ app_id: "app-1" });
    expect(Object.keys(account).sort()).toEqual(["address", "app_id", "created_time_stamp", "display_name", "reply_to"]);
  });

  it("sends reply_to when given, an address or null", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
    stubWindow(fetchImpl);
    await createAccount("support@shop.example");
    expect(bodyOf(fetchImpl)).toEqual({ app_id: "app-1", reply_to: "support@shop.example" });

    const withNull = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
    stubWindow(withNull);
    await createAccount(null);
    expect(bodyOf(withNull)).toEqual({ app_id: "app-1", reply_to: null });
  });
});

describe("template shapes", () => {
  it("createTemplate's answer carries no html; templateInfo's does; both carry the three template-send fields", async () => {
    const metaOnly = { ok: true, template: templateRow };
    const withHtml = { ok: true, template: { ...templateRow, html: "<p/>" } };

    const createFetch = vi.fn().mockResolvedValue(jsonResponse(200, metaOnly));
    stubWindow(createFetch);
    const meta = await createTemplate(newTemplate);
    expect(meta).not.toHaveProperty("html");
    expect(meta).toMatchObject({ recipient: "me@x.test", send_group: "g1", deny_group: null });

    const infoFetch = vi.fn().mockResolvedValue(jsonResponse(200, withHtml));
    stubWindow(infoFetch);
    const full = await templateInfo("t1");
    expect(full.html).toBe("<p/>");
    expect(full).toMatchObject({ recipient: "me@x.test", send_group: "g1", deny_group: null });
  });

  it("createTemplate sends the recipient and the groups it is given, and leaves omitted groups off the wire", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, template: templateRow }));
    stubWindow(fetchImpl);
    await createTemplate(newTemplate);
    expect(bodyOf(fetchImpl)).toEqual({ name: "n", subject: "s", html: "<p/>", recipient: "me@x.test" });

    const withGroups = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, template: templateRow }));
    stubWindow(withGroups);
    await createTemplate({ ...newTemplate, send_group: "g1", deny_group: null });
    expect(bodyOf(withGroups)).toEqual({
      name: "n",
      subject: "s",
      html: "<p/>",
      recipient: "me@x.test",
      send_group: "g1",
      deny_group: null,
    });
  });

  it("createTemplate requires a recipient — a create without one is the server's 400", () => {
    // @ts-expect-error recipient is required
    const noRecipient: CreateTemplateBody = { name: null, subject: "s", html: "<p/>" };
    void noRecipient;
  });

  it("updateTemplate sends the optional fields only when given; null empties a group", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, template: templateRow }));
    stubWindow(fetchImpl);
    await updateTemplate("t1", { subject: "s", html: "<p/>" });
    expect(bodyOf(fetchImpl)).toEqual({ subject: "s", html: "<p/>" });

    const withAll = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, template: templateRow }));
    stubWindow(withAll);
    await updateTemplate("t1", { subject: "s", html: "<p/>", recipient: "new@x.test", send_group: null, deny_group: "d1" });
    expect(bodyOf(withAll)).toEqual({ subject: "s", html: "<p/>", recipient: "new@x.test", send_group: null, deny_group: "d1" });
  });

  it("updateTemplate requires both subject and html, and cannot empty the recipient", () => {
    // @ts-expect-error subject alone is not a full replace
    const subjectOnly: UpdateTemplateBody = { subject: "s" };
    void subjectOnly;
    // @ts-expect-error html alone is not a full replace
    const htmlOnly: UpdateTemplateBody = { html: "<p/>" };
    void htmlOnly;
    // @ts-expect-error a template always has its recipient
    const noRecipient: UpdateTemplateBody = { subject: "s", html: "<p/>", recipient: null };
    void noRecipient;
  });
});

describe("listAllTemplates", () => {
  it("walks a two-page cursor to the end, sending limit: 100 on every page", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          ok: true,
          templates: [{ template_id: "t1" }],
          next_cursor: { after_created_time_stamp: 1, after_template_id: "t1" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, templates: [{ template_id: "t2" }], next_cursor: null }));
    stubWindow(fetchImpl);
    const rows = await listAllTemplates();
    expect(rows).toHaveLength(2);
    for (const call of fetchImpl.mock.calls) {
      const init = call[1] as RequestInit;
      expect(JSON.parse(init.body as string).limit).toBe(100);
    }
  });
});

describe("degraded templates — nameless, and bodyless", () => {
  // Both cases are states the service deliberately keeps VISIBLE so an owner
  // can diagnose them, which is exactly when a consumer needs the types to be
  // honest. Until the 2026-09 client review `name` was typed `string` and
  // `html` was typed required.
  it("reads back a null name from a nameless template", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        template: {
          ...templateRow,
          name: null,
        },
      }),
    );
    stubWindow(fetchImpl);
    const meta = await createTemplate({ ...newTemplate, name: null });
    expect(meta.name).toBeNull();
    expect(JSON.parse(fetchImpl.mock.calls[0]?.[1].body as string).name).toBeNull();
  });

  it("reads a template whose html key is absent — the orphaned-R2 case", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        template: templateRow,
      }),
    );
    stubWindow(fetchImpl);
    const full = await templateInfo("t1");
    // Absent, not null — `"html" in full` is the correct discriminator.
    expect("html" in full).toBe(false);
    expect(full.html).toBeUndefined();
  });
});

describe("challenge: every function sends { challenge } as x-pilely-challenge", () => {
  type Request = { challenge?: string | (() => Promise<string>) };
  const cases: [string, (request: Request) => Promise<unknown>][] = [
    ["sendTemplate", (r) => sendTemplate("t1", {}, r)],
    ["createAccount", (r) => createAccount(undefined, r)],
    ["listAccounts", (r) => listAccounts({}, r)],
    ["listAllAccounts", (r) => listAllAccounts(r)],
    ["accountInfo", (r) => accountInfo(r)],
    ["deleteAccount", (r) => deleteAccount(r)],
    ["setReplyTo", (r) => setReplyTo(null, r)],
    ["createTemplate", (r) => createTemplate(newTemplate, r)],
    ["listTemplates", (r) => listTemplates({}, r)],
    ["listAllTemplates", (r) => listAllTemplates(r)],
    ["templateInfo", (r) => templateInfo("t1", r)],
    ["updateTemplate", (r) => updateTemplate("t1", { subject: "s", html: "<p/>" }, r)],
    ["deleteTemplate", (r) => deleteTemplate("t1", r)],
  ];

  function challengesSent(fetchImpl: ReturnType<typeof vi.fn>): (string | undefined)[] {
    return fetchImpl.mock.calls.map(
      (call) => ((call[1] as RequestInit).headers as Record<string, string>)["x-pilely-challenge"],
    );
  }

  it.each(cases)("%s sends the answer once, on its one request", async (_name, run) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
    stubWindow(fetchImpl);
    await run({ challenge: "answer-1" });
    expect(challengesSent(fetchImpl)).toEqual(["answer-1"]);
  });

  it.each(cases)("%s sends no x-pilely-challenge without one", async (_name, run) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
    stubWindow(fetchImpl);
    await run({});
    expect(challengesSent(fetchImpl)).toEqual([undefined]);
  });

  it("a function challenge is asked for each request: two sends, two fresh answers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
    stubWindow(fetchImpl);
    let n = 0;
    const challenge = vi.fn(async () => `fresh-${++n}`);
    await sendTemplate("t1", { name: "Ada" }, { challenge });
    await sendTemplate("t1", { name: "Ada" }, { challenge });
    expect(challengesSent(fetchImpl)).toEqual(["fresh-1", "fresh-2"]);
    expect(bodyOf(fetchImpl)).not.toHaveProperty("challenge");
  });

  it("reads both challenge 403s with their codes", async () => {
    for (const code of ["challenge_required", "challenge_failed"] satisfies SimpleEmailErrorCode[]) {
      stubWindow(vi.fn().mockResolvedValue(jsonResponse(403, { ok: false, code, reason: "r" })));
      await expect(sendTemplate("t1", {})).rejects.toMatchObject({
        status: 403,
        code,
      });
    }
  });
});
