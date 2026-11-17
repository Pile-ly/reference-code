import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock mode is a build-time switch read when modules load, so it is set
// before any import below is evaluated.
vi.hoisted(() => {
  vi.stubEnv("VITE_PILELY_MOCK", "1");
});

import { appId, call, PilelyError, resetMock } from "@pilely/core";
import type { PilelyClient } from "@pilely/core";
import {
  accountInfo,
  createAccount,
  createTemplate,
  listAllAccounts,
  listAllTemplates,
  sendTemplate,
  setReplyTo,
  templateInfo,
  updateTemplate,
} from "./api.js";
import { MOCK_ANON_GROUP, MOCK_AUTH_GROUP } from "./mock.js";

let globalFetchSpy: ReturnType<typeof vi.fn>;
let consoleLog: ReturnType<typeof vi.spyOn>;

function pilely(): PilelyClient {
  const client = (globalThis as { window?: { pilely?: PilelyClient } }).window?.pilely;
  if (!client) throw new Error("window.pilely is not set");
  return client;
}

/** What the fake logged as its outbox: one entry per template send. */
function outbox(): { to: unknown; subject: unknown; html: unknown }[] {
  return consoleLog.mock.calls
    .filter((c: unknown[]) => String(c[0]).includes("simple-email outbox"))
    .map((c: unknown[]) => c[1] as { to: unknown; subject: unknown; html: unknown });
}

const contact = {
  name: "contact",
  subject: "New message from {{name}}",
  html: "<p>{{ message }}</p>",
  recipient: "owner@shop.example",
};

beforeEach(async () => {
  (globalThis as { window?: unknown }).window = {};
  globalFetchSpy = vi.fn();
  (globalThis as { fetch?: unknown }).fetch = globalFetchSpy;
  consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
  resetMock();
  appId();
  await pilely().signIn();
});

afterEach(() => {
  expect(globalFetchSpy).not.toHaveBeenCalled();
  consoleLog.mockRestore();
  resetMock();
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { fetch?: unknown }).fetch;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("simple-email fake", () => {
  it("a template send lands in the outbox and the console at the stored recipient, never the network or the answer", async () => {
    await createAccount();
    const meta = await createTemplate({ ...contact, send_group: MOCK_AUTH_GROUP });

    const result = await sendTemplate(meta.template_id, { name: "Ada", message: "Hello!" });
    expect(result).toEqual({ send_id: expect.any(String) });
    expect(JSON.stringify(result)).not.toContain("owner@shop.example");

    expect(outbox()).toEqual([{ from: expect.any(String), to: "owner@shop.example", subject: "New message from Ada", html: "<p>Hello!</p>" }]);

    const info = await accountInfo();
    expect(info).toEqual({
      account: {
        app_id: "mock-app",
        address: expect.any(String),
        display_name: null,
        reply_to: null,
        created_time_stamp: expect.any(Number),
      },
      daily_cap: 200,
      sent_today: 1,
      credit_blocked: false,
    });
  });

  it("ignores every field but the template's variables, and ignores a challenge", async () => {
    await createAccount();
    const meta = await createTemplate({ ...contact, send_group: MOCK_AUTH_GROUP });
    const wire = (body: unknown) =>
      call<{ ok: true; send_id: string }>({
        service: "simple-email",
        path: `/accounts/${appId()}/templates/${meta.template_id}/send`,
        body,
        challenge: "answer",
      });
    const result = await wire({
      name: "Ada",
      message: "Hi",
      to: ["attacker@evil.example"],
      subject: "Other",
      html: "<p>other</p>",
      template_id: "other",
    });
    expect(result).toEqual({ ok: true, send_id: expect.any(String) });
    expect(outbox()).toEqual([{ from: expect.any(String), to: "owner@shop.example", subject: "New message from Ada", html: "<p>Hi</p>" }]);
  });

  it("refuses a missing or non-string variable with a 400 and sends nothing", async () => {
    await createAccount();
    const meta = await createTemplate({ ...contact, send_group: MOCK_AUTH_GROUP });
    await expect(sendTemplate(meta.template_id, { name: "Ada" })).rejects.toMatchObject({ status: 400, code: "bad_request" });
    const wire = (body: unknown) =>
      call({ service: "simple-email", path: `/accounts/${appId()}/templates/${meta.template_id}/send`, body });
    await expect(wire({ name: "Ada", message: 7 })).rejects.toMatchObject({ status: 400, code: "bad_request" });
    await expect(wire(["Ada"])).rejects.toMatchObject({ status: 400, code: "bad_request" });
    expect(outbox()).toEqual([]);
    expect((await accountInfo()).sent_today).toBe(0);
  });

  it("admits by send_group: the anonymous group holds signed-out visitors, the authenticated group signed-in people", async () => {
    await createAccount();
    const visitors = await createTemplate({ ...contact, send_group: MOCK_ANON_GROUP });
    const members = await createTemplate({ ...contact, send_group: MOCK_AUTH_GROUP });
    const vars = { name: "Ada", message: "Hi" };

    // Signed in: the authenticated group admits, the anonymous group does not.
    await expect(sendTemplate(members.template_id, vars)).resolves.toMatchObject({ send_id: expect.any(String) });
    await expect(sendTemplate(visitors.template_id, vars)).rejects.toMatchObject({ status: 404, code: null });

    // Signed out: the other way round.
    pilely().signOut();
    await expect(sendTemplate(visitors.template_id, vars)).resolves.toMatchObject({ send_id: expect.any(String) });
    await expect(sendTemplate(members.template_id, vars)).rejects.toBeInstanceOf(PilelyError);
    await expect(sendTemplate(members.template_id, vars)).rejects.toMatchObject({ status: 404, code: null });
    expect(outbox()).toHaveLength(2);
  });

  it("an empty send_group, an owner group and an unknown template admit nobody: the bare 404", async () => {
    await createAccount();
    const empty = await createTemplate(contact);
    expect(empty.send_group).toBeNull();
    const ownerGroup = await createTemplate({ ...contact, send_group: "ownerGroup0001" });
    const vars = { name: "Ada", message: "Hi" };
    for (const id of [empty.template_id, ownerGroup.template_id, "missing"]) {
      await expect(sendTemplate(id, vars)).rejects.toMatchObject({ status: 404, code: null });
    }
    expect(outbox()).toEqual([]);
  });

  it("answers the freestyle send with the bare 404: no browser caller is the app's backend", async () => {
    await createAccount();
    const meta = await createTemplate({ ...contact, send_group: MOCK_AUTH_GROUP });
    await expect(
      call({
        service: "simple-email",
        path: `/accounts/${appId()}/send`,
        body: { to: ["a@example.com"], template_id: meta.template_id, variables: { name: "Ada", message: "Hi" } },
      }),
    ).rejects.toMatchObject({ status: 404, code: null });
    expect(outbox()).toEqual([]);
  });

  it("keeps the template shapes, with recipient, send_group and deny_group", async () => {
    await createAccount();
    await expect(createAccount()).rejects.toMatchObject({ status: 409, code: "account_exists" });
    const meta = await createTemplate({ ...contact, send_group: MOCK_ANON_GROUP, deny_group: "blocked0001" });
    expect(meta).toEqual({
      template_id: expect.any(String),
      name: "contact",
      subject: "New message from {{name}}",
      recipient: "owner@shop.example",
      send_group: MOCK_ANON_GROUP,
      deny_group: "blocked0001",
      created_time_stamp: expect.any(Number),
      updated_time_stamp: expect.any(Number),
    });
    expect(await templateInfo(meta.template_id)).toEqual({ ...meta, html: "<p>{{ message }}</p>" });

    // Omitted keys keep the stored value; null empties a group.
    const updated = await updateTemplate(meta.template_id, { subject: "Yo", html: "<p>yo</p>", deny_group: null });
    expect(updated).toMatchObject({ subject: "Yo", recipient: "owner@shop.example", send_group: MOCK_ANON_GROUP, deny_group: null });
    const moved = await updateTemplate(meta.template_id, { subject: "Yo", html: "<p>yo</p>", recipient: "new@shop.example" });
    expect(moved).toMatchObject({ recipient: "new@shop.example", send_group: MOCK_ANON_GROUP });
    expect(await listAllTemplates()).toEqual([moved]);
    await expect(templateInfo("missing")).rejects.toMatchObject({ status: 404, code: null });
  });

  it("refuses the template shapes the server refuses, on the wire", async () => {
    await createAccount();
    const create = (body: Record<string, unknown>) =>
      call({ service: "simple-email", path: `/accounts/${appId()}/templates/create`, body });
    for (const body of [
      { subject: "s", html: "<p/>" },
      { subject: "s", html: "<p/>", recipient: "not an address" },
      { subject: "s", html: "<p/>", recipient: "me@shop.example", send_group: "" },
      { subject: "s", html: "<p/>", recipient: "me@shop.example", send_group: 7 },
      { subject: "s", html: "<p/>", recipient: "me@shop.example", deny_group: MOCK_ANON_GROUP },
      { subject: "s", html: "<p/>", recipient: "me@shop.example", deny_group: MOCK_AUTH_GROUP },
    ]) {
      await expect(create(body)).rejects.toMatchObject({ status: 400, code: "bad_request" });
    }
    const meta = await createTemplate(contact);
    const update = (body: Record<string, unknown>) =>
      call({ service: "simple-email", path: `/accounts/${appId()}/templates/${meta.template_id}/update`, body });
    await expect(update({ subject: "s", html: "<p/>", recipient: null })).rejects.toMatchObject({ status: 400, code: "bad_request" });
    await expect(update({ subject: "s" })).rejects.toMatchObject({ status: 400, code: "bad_request" });
    expect(await listAllTemplates()).toEqual([meta]);
  });

  it("refuses a signed-out owner write with the bare 404", async () => {
    await createAccount();
    pilely().signOut();
    await expect(createTemplate(contact)).rejects.toMatchObject({ status: 404, code: null });
    await expect(setReplyTo(null)).rejects.toMatchObject({ status: 404, code: null });
  });

  it("accounts carry exactly app_id, address, display_name, reply_to and created_time_stamp", async () => {
    const keys = ["address", "app_id", "created_time_stamp", "display_name", "reply_to"];
    const created = await createAccount();
    expect(Object.keys(created).sort()).toEqual(keys);
    expect(Object.keys((await listAllAccounts())[0] ?? {}).sort()).toEqual(keys);
    expect(Object.keys((await accountInfo()).account).sort()).toEqual(keys);
    // A create body carrying an account-level send_group is answered without it.
    const wire = await call<{ account: Record<string, unknown> }>({
      service: "simple-email",
      path: "/accounts/create",
      body: { app_id: "other-app", send_group: "g1" },
    });
    expect(Object.keys(wire.account).sort()).toEqual(keys);
  });

  it("carries reply_to on create, set_reply_to, info and list", async () => {
    const created = await createAccount();
    expect(created.reply_to).toBeNull();
    const set = await setReplyTo("support@shop.example");
    expect(set.reply_to).toBe("support@shop.example");
    expect((await accountInfo()).account.reply_to).toBe("support@shop.example");
    expect((await listAllAccounts())[0]?.reply_to).toBe("support@shop.example");
    expect((await setReplyTo(null)).reply_to).toBeNull();
    expect((await accountInfo()).account.reply_to).toBeNull();
  });

  it("stores a reply_to given on create", async () => {
    const created = await createAccount("owner@shop.example");
    expect(created.reply_to).toBe("owner@shop.example");
    expect((await listAllAccounts())[0]?.reply_to).toBe("owner@shop.example");
  });

  it("refuses set_reply_to without the key, and a non-string value, on the wire", async () => {
    await createAccount();
    const wire = (body: Record<string, unknown>) =>
      call({ service: "simple-email", path: `/accounts/${appId()}/set_reply_to`, body });
    await expect(wire({})).rejects.toMatchObject({ status: 400, code: "bad_request" });
    await expect(wire({ reply_to: 7 })).rejects.toMatchObject({ status: 400, code: "bad_request" });
    expect((await accountInfo()).account.reply_to).toBeNull();
  });
});
