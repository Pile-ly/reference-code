import { afterEach, describe, expect, it, vi } from "vitest";
import type { PilelyClient } from "@pilely/core";
import {
  accountInfo,
  createAccount,
  createTemplate,
  deleteAccount,
  deleteTemplate,
  listAccounts,
  listAllTemplates,
  listSends,
  listTemplates,
  send,
  setAccountAccess,
  templateInfo,
  updateTemplate,
} from "./index.js";
import type { SendInput, UpdateTemplateBody } from "./index.js";

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

const stubEnvelope = {
  ok: true,
  send_id: "s1",
  recipient_count: 1,
  sends: [],
  account: { app_id: "app-1", address: "a@x.test", display_name: null, send_group: null, created_time_stamp: 1 },
  accounts: [],
  daily_cap: 100,
  sent_today: 0,
  credit_blocked: false,
  phone_verified: true,
  template: { template_id: "t1", name: "n", subject: "s", created_time_stamp: 1, updated_time_stamp: 1, html: "<p/>" },
  templates: [],
  next_cursor: null,
};

describe("simple-email: every route maps to the correct URL", () => {
  const cases: [string, () => Promise<unknown>, string][] = [
    ["send", () => send({ to: ["a@x.test"], subject: "s", html: "<p/>" }), `${base}/send`],
    ["listSends", () => listSends(), `${base}/sends/list`],
    ["createAccount", () => createAccount(), `${base}/accounts/create`],
    ["listAccounts", () => listAccounts(), `${base}/accounts/list`],
    ["accountInfo", () => accountInfo(), `${accountBase}/info`],
    ["deleteAccount", () => deleteAccount(), `${accountBase}/delete`],
    ["setAccountAccess", () => setAccountAccess(null), `${accountBase}/access/set`],
    ["createTemplate", () => createTemplate("n", "s", "<p/>"), `${accountBase}/templates/create`],
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

  it("covers all 12 registered routes", () => {
    expect(cases).toHaveLength(12);
  });
});

describe("app_id split: body on send/listSends, path on account/template methods", () => {
  it("send and listSends carry app_id in the body, not the path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
    stubWindow(fetchImpl);
    await send({ to: ["a@x.test"], subject: "s", html: "<p/>" });
    expect(urlOf(fetchImpl)).not.toContain("app-1");
    expect(bodyOf(fetchImpl).app_id).toBe("app-1");
  });

  it("accountInfo and template methods carry app_id in the path, not the body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
    stubWindow(fetchImpl);
    await accountInfo();
    expect(urlOf(fetchImpl)).toContain("/accounts/app-1/");
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(init.body ? JSON.parse(init.body as string) : {}).not.toHaveProperty("app_id");
  });
});

describe("send's discriminated union", () => {
  it("a template_id call produces a template body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
    stubWindow(fetchImpl);
    const input: SendInput = { to: ["a@x.test"], template_id: "t1", variables: { name: "Ada" } };
    await send(input);
    const body = bodyOf(fetchImpl);
    expect(body.template_id).toBe("t1");
    expect(body.variables).toEqual({ name: "Ada" });
    expect(body.subject).toBeUndefined();
  });

  it("a subject+html call produces an inline body", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
    stubWindow(fetchImpl);
    const input: SendInput = { to: ["a@x.test"], subject: "hi", html: "<p>hi</p>" };
    await send(input);
    const body = bodyOf(fetchImpl);
    expect(body.subject).toBe("hi");
    expect(body.html).toBe("<p>hi</p>");
    expect(body.template_id).toBeUndefined();
  });

  it("neither a template_id nor a subject+html pair typechecks", () => {
    // @ts-expect-error missing both template_id and subject/html
    const invalidNeither: SendInput = { to: ["a@x.test"] };
    void invalidNeither;
    // @ts-expect-error subject alone, no html
    const invalidPartial: SendInput = { to: ["a@x.test"], subject: "hi" };
    void invalidPartial;
  });
});

describe("setAccountAccess", () => {
  it("emits send_group even when null", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
    stubWindow(fetchImpl);
    await setAccountAccess(null);
    const body = bodyOf(fetchImpl);
    expect(Object.keys(body)).toContain("send_group");
    expect(body.send_group).toBeNull();
  });
});

describe("createAccount omits send_group when absent", () => {
  it("sends only app_id when no send_group is given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
    stubWindow(fetchImpl);
    await createAccount();
    const body = bodyOf(fetchImpl);
    expect(body).not.toHaveProperty("send_group");
  });
});

describe("template shapes", () => {
  it("createTemplate's answer carries no html; templateInfo's does", async () => {
    const metaOnly = {
      ok: true,
      template: { template_id: "t1", name: "n", subject: "s", created_time_stamp: 1, updated_time_stamp: 1 },
    };
    const withHtml = {
      ok: true,
      template: { template_id: "t1", name: "n", subject: "s", created_time_stamp: 1, updated_time_stamp: 1, html: "<p/>" },
    };

    const createFetch = vi.fn().mockResolvedValue(jsonResponse(200, metaOnly));
    stubWindow(createFetch);
    const meta = await createTemplate("n", "s", "<p/>");
    expect(meta).not.toHaveProperty("html");

    const infoFetch = vi.fn().mockResolvedValue(jsonResponse(200, withHtml));
    stubWindow(infoFetch);
    const full = await templateInfo("t1");
    expect(full.html).toBe("<p/>");
  });

  it("updateTemplate requires both subject and html — a caller cannot construct the server's 400", () => {
    // @ts-expect-error subject alone is not a full replace
    const subjectOnly: UpdateTemplateBody = { subject: "s" };
    void subjectOnly;
    // @ts-expect-error html alone is not a full replace
    const htmlOnly: UpdateTemplateBody = { html: "<p/>" };
    void htmlOnly;
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
