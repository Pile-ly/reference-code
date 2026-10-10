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
} from "./api.js";
import type { AccountSendInput, SendInput, SendResult, UpdateTemplateBody } from "./api.js";
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

const stubEnvelope = {
  ok: true,
  send_id: "s1",
  recipient_count: 1,
  replayed: false,
  sends: [],
  account: {
    app_id: "app-1",
    address: "a@x.test",
    display_name: null,
    send_group: null,
    account_senders: "send_group",
    created_time_stamp: 1,
  },
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

  it("an account send carries to_account and the template, and no to, subject or html", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
    stubWindow(fetchImpl);
    const input: SendInput = { to_account: "self", template_id: "t1", variables: { name: "Ada" } };
    await send(input);
    expect(bodyOf(fetchImpl)).toEqual({
      app_id: "app-1",
      to_account: "self",
      template_id: "t1",
      variables: { name: "Ada" },
    });
  });

  it("an owner account send is the same shape with to_account: owner", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
    stubWindow(fetchImpl);
    const input: AccountSendInput = { to_account: "owner", template_id: "t1" };
    await send(input);
    const body = bodyOf(fetchImpl);
    expect(body.to_account).toBe("owner");
    expect(body).not.toHaveProperty("to");
    expect(body).not.toHaveProperty("idempotency_key");
  });

  it("to and to_account together, an account send with inline content, or one without a template do not typecheck", () => {
    // @ts-expect-error to and to_account together
    const both: SendInput = { to: ["a@x.test"], to_account: "self", template_id: "t1" };
    void both;
    // @ts-expect-error to and to_account together, inline arm
    const bothInline: SendInput = { to: ["a@x.test"], to_account: "owner", subject: "s", html: "<p/>" };
    void bothInline;
    // @ts-expect-error an account send is template-only
    const inlineAccount: SendInput = { to_account: "self", subject: "s", html: "<p/>" };
    void inlineAccount;
    // @ts-expect-error an account send needs template_id
    const noTemplate: SendInput = { to_account: "self" };
    void noTemplate;
    // @ts-expect-error to_account is "self" or "owner" only
    const otherAccount: SendInput = { to_account: "someone", template_id: "t1" };
    void otherAccount;
  });
});

describe("idempotency_key and replayed", () => {
  it("puts idempotency_key on the wire in every shape", async () => {
    const shapes: SendInput[] = [
      { to: ["a@x.test"], subject: "s", html: "<p/>", idempotency_key: "k-inline" },
      { to: ["a@x.test"], template_id: "t1", idempotency_key: "k-template" },
      { to_account: "self", template_id: "t1", idempotency_key: "confirm:row-1" },
    ];
    for (const input of shapes) {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
      stubWindow(fetchImpl);
      await send(input);
      expect(bodyOf(fetchImpl).idempotency_key).toBe(input.idempotency_key);
    }
  });

  it("leaves idempotency_key off the wire when it is not given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
    stubWindow(fetchImpl);
    await send({ to: ["a@x.test"], subject: "s", html: "<p/>" });
    expect(bodyOf(fetchImpl)).not.toHaveProperty("idempotency_key");
  });

  it("carries replayed in the result", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ok: true, send_id: "s-first", recipient_count: 1, replayed: true }));
    stubWindow(fetchImpl);
    const result: SendResult = await send({ to: ["a@x.test"], template_id: "t1", idempotency_key: "k" });
    expect(result.replayed).toBe(true);
    expect(result.send_id).toBe("s-first");
  });

  it("reads both idempotency 409s with their codes", async () => {
    for (const code of ["idempotency_key_reused", "idempotency_key_in_progress"] satisfies SimpleEmailErrorCode[]) {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { ok: false, code, reason: "r" }));
      stubWindow(fetchImpl);
      await expect(send({ to: ["a@x.test"], template_id: "t1", idempotency_key: "k" })).rejects.toMatchObject({
        status: 409,
        code,
      });
    }
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

  it("omits account_senders when not given (the server keeps the current value)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
    stubWindow(fetchImpl);
    await setAccountAccess("g1");
    expect(bodyOf(fetchImpl)).toEqual({ send_group: "g1" });
  });

  it("sends account_senders beside send_group when given, and reads it back on the account", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { ok: true, account: { ...stubEnvelope.account, account_senders: "app_users" } }),
    );
    stubWindow(fetchImpl);
    const account = await setAccountAccess(null, "app_users");
    expect(bodyOf(fetchImpl)).toEqual({ send_group: null, account_senders: "app_users" });
    expect(account.account_senders).toBe("app_users");
  });
});

describe("createAccount omits send_group when absent", () => {
  it("sends only app_id when no send_group is given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
    stubWindow(fetchImpl);
    await createAccount();
    const body = bodyOf(fetchImpl);
    expect(body).not.toHaveProperty("send_group");
    expect(body).not.toHaveProperty("account_senders");
  });

  it("sends account_senders when given, with or without a send group", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
    stubWindow(fetchImpl);
    await createAccount(undefined, "app_users");
    expect(bodyOf(fetchImpl)).toEqual({ app_id: "app-1", account_senders: "app_users" });

    const withGroup = vi.fn().mockResolvedValue(jsonResponse(200, stubEnvelope));
    stubWindow(withGroup);
    await createAccount("g1", "send_group");
    expect(bodyOf(withGroup)).toEqual({ app_id: "app-1", send_group: "g1", account_senders: "send_group" });
  });

  it("account_senders accepts only the two values", () => {
    // @ts-expect-error not an AccountSenders value
    const other: Parameters<typeof createAccount>[1] = "everyone";
    void other;
    // @ts-expect-error null is a 400 on the server — omit the argument instead
    const explicitNull: Parameters<typeof setAccountAccess>[1] = null;
    void explicitNull;
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
          template_id: "t1",
          name: null,
          subject: "s",
          created_time_stamp: 1,
          updated_time_stamp: 1,
        },
      }),
    );
    stubWindow(fetchImpl);
    const meta = await createTemplate(null, "s", "<p/>");
    expect(meta.name).toBeNull();
    expect(JSON.parse(fetchImpl.mock.calls[0]?.[1].body as string).name).toBeNull();
  });

  it("reads a template whose html key is absent — the orphaned-R2 case", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        template: {
          template_id: "t1",
          name: "n",
          subject: "s",
          created_time_stamp: 1,
          updated_time_stamp: 1,
        },
      }),
    );
    stubWindow(fetchImpl);
    const full = await templateInfo("t1");
    // Absent, not null — `"html" in full` is the correct discriminator.
    expect("html" in full).toBe(false);
    expect(full.html).toBeUndefined();
  });
});
