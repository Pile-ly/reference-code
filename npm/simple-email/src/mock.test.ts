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
  listAllSends,
  listAllTemplates,
  send,
  setAccountAccess,
  templateInfo,
  updateTemplate,
} from "./api.js";

let globalFetchSpy: ReturnType<typeof vi.fn>;
let consoleLog: ReturnType<typeof vi.spyOn>;

function pilely(): PilelyClient {
  const client = (globalThis as { window?: { pilely?: PilelyClient } }).window?.pilely;
  if (!client) throw new Error("window.pilely is not set");
  return client;
}

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
  it("send lands in the outbox and the console, never the network", async () => {
    const result = await send({ to: ["a@example.com", "b@example.com"], subject: "Hi", html: "<p>hi</p>" });
    expect(result).toEqual({ ok: true, send_id: expect.any(String), recipient_count: 2, replayed: false });

    const sends = await listAllSends();
    expect(sends).toEqual([
      {
        send_id: result.send_id,
        requester_user_id: "mock-user",
        via_app: true,
        kind: "inline",
        template_id: null,
        subject: "Hi",
        recipients: ["a@example.com", "b@example.com"],
        recipient_count: 2,
        outcome: "sent",
        outcome_reason: null,
        to_account: null,
        idempotency_key: null,
        fired_at: expect.any(Number),
      },
    ]);
    expect(consoleLog).toHaveBeenCalledTimes(1);
    expect(String(consoleLog.mock.calls[0]?.[0])).toContain("simple-email outbox");

    const info = await accountInfo();
    expect(info).toEqual({
      account: {
        app_id: "mock-app",
        address: expect.any(String),
        display_name: null,
        send_group: null,
        account_senders: "send_group",
        created_time_stamp: expect.any(Number),
      },
      daily_cap: 200,
      sent_today: 2,
      credit_blocked: false,
      phone_verified: true,
    });
  });

  it("renders a template send and keeps the template shapes", async () => {
    await createAccount();
    await expect(createAccount()).rejects.toMatchObject({ status: 409, code: "account_exists" });
    const meta = await createTemplate("welcome", "Hello {{name}}", "<p>Hi {{name}}</p>");
    expect(meta).toEqual({
      template_id: expect.any(String),
      name: "welcome",
      subject: "Hello {{name}}",
      created_time_stamp: expect.any(Number),
      updated_time_stamp: expect.any(Number),
    });
    expect(await templateInfo(meta.template_id)).toEqual({ ...meta, html: "<p>Hi {{name}}</p>" });

    await send({ to: ["a@example.com"], template_id: meta.template_id, variables: { name: "Ada" } });
    const [row] = await listAllSends();
    expect(row).toMatchObject({ kind: "template", template_id: meta.template_id, subject: "Hello Ada" });

    const updated = await updateTemplate(meta.template_id, { subject: "Yo", html: "<p>yo</p>" });
    expect(updated.subject).toBe("Yo");
    expect(await listAllTemplates()).toEqual([updated]);
    await expect(templateInfo("missing")).rejects.toMatchObject({ status: 404, code: null });
    await expect(
      send({ to: ["a@example.com"], template_id: "missing" }),
    ).rejects.toMatchObject({ status: 400, code: "bad_request" });
  });

  it("refuses a signed-out send with the bare 404, then accepts it after signIn", async () => {
    pilely().signOut();
    await expect(send({ to: ["a@example.com"], subject: "s", html: "h" })).rejects.toBeInstanceOf(PilelyError);
    await expect(send({ to: ["a@example.com"], subject: "s", html: "h" })).rejects.toMatchObject({
      status: 404,
      code: null,
    });
    await pilely().signIn();
    await expect(send({ to: ["a@example.com"], subject: "s", html: "h" })).resolves.toMatchObject({
      recipient_count: 1,
    });
  });

  it("replays a repeated idempotency_key and refuses it with another body", async () => {
    const first = await send({ to: ["a@example.com"], subject: "s", html: "h", idempotency_key: "digest:u1:2026-10-07" });
    expect(first.replayed).toBe(false);
    // Same body, recipients in another case: the same request.
    const again = await send({ to: ["A@example.com"], subject: "s", html: "h", idempotency_key: "digest:u1:2026-10-07" });
    expect(again).toEqual({ ok: true, send_id: first.send_id, recipient_count: 1, replayed: true });

    const sends = await listAllSends();
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ send_id: first.send_id, idempotency_key: "digest:u1:2026-10-07", to_account: null });
    expect((await accountInfo()).sent_today).toBe(1);
    expect(consoleLog).toHaveBeenCalledTimes(1);

    await expect(
      send({ to: ["a@example.com"], subject: "other", html: "h", idempotency_key: "digest:u1:2026-10-07" }),
    ).rejects.toMatchObject({ status: 409, code: "idempotency_key_reused" });
    await expect(send({ to: ["a@example.com"], subject: "s", html: "h", idempotency_key: "bad key!" })).rejects.toMatchObject({
      status: 400,
      code: "bad_request",
    });
    // Without a key every request is a new send.
    await send({ to: ["a@example.com"], subject: "s", html: "h" });
    expect(await listAllSends()).toHaveLength(2);
  });

  it("makes self and owner account sends: one recipient, no address in the answer or on the self row", async () => {
    await createAccount();
    const meta = await createTemplate("got-it", "We got it", "<p>Thanks {{name}}</p>");

    const self = await send({ to_account: "self", template_id: meta.template_id, variables: { name: "Ada" }, idempotency_key: "row-1" });
    expect(self).toEqual({ ok: true, send_id: expect.any(String), recipient_count: 1, replayed: false });
    const owner = await send({ to_account: "owner", template_id: meta.template_id, variables: { name: "Ada" } });
    expect(JSON.stringify(owner)).not.toContain("@");

    const rows = await listAllSends();
    const selfRow = rows.find((r) => r.send_id === self.send_id);
    const ownerRow = rows.find((r) => r.send_id === owner.send_id);
    expect(selfRow).toMatchObject({ to_account: "self", recipients: [], recipient_count: 1, idempotency_key: "row-1", kind: "template" });
    expect(ownerRow).toMatchObject({ to_account: "owner", recipient_count: 1, idempotency_key: null });
    expect(ownerRow?.recipients).toEqual([expect.stringContaining("@")]);

    // A repeat of the keyed account send replays it.
    const replay = await send({ to_account: "self", template_id: meta.template_id, variables: { name: "Ada" }, idempotency_key: "row-1" });
    expect(replay).toMatchObject({ send_id: self.send_id, replayed: true });
  });

  it("refuses the account-send shapes the server refuses, on the wire", async () => {
    await createAccount();
    const meta = await createTemplate(null, "s", "<p/>");
    // Straight to the fake, past `send`'s typed body builder.
    const wire = (body: Record<string, unknown>) =>
      call({ service: "simple-email", path: "/send", body: { app_id: appId(), ...body } });
    for (const input of [
      { to: ["a@example.com"], to_account: "self", template_id: meta.template_id },
      { to_account: "self", subject: "s", html: "<p/>" },
      { to_account: "self" },
      { to_account: "someone", template_id: meta.template_id },
      { to_account: "owner", template_id: meta.template_id, idempotency_key: "" },
      {},
    ]) {
      await expect(wire(input)).rejects.toMatchObject({ status: 400, code: "bad_request" });
    }
  });

  it("carries account_senders on create, access/set and list", async () => {
    const created = await createAccount(null, "app_users");
    expect(created.account_senders).toBe("app_users");
    // Omitted keeps the current value.
    expect((await setAccountAccess("g1")).account_senders).toBe("app_users");
    const set = await setAccountAccess(null, "send_group");
    expect(set).toMatchObject({ send_group: null, account_senders: "send_group" });
    expect((await listAllAccounts())[0]?.account_senders).toBe("send_group");
    expect((await accountInfo()).account.account_senders).toBe("send_group");
  });
});
