import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock mode is a build-time switch read when modules load, so it is set
// before any import below is evaluated.
vi.hoisted(() => {
  vi.stubEnv("VITE_PILELY_MOCK", "1");
});

import { appId, PilelyError, resetMock } from "@pilely/core";
import type { PilelyClient } from "@pilely/core";
import {
  accountInfo,
  createAccount,
  createTemplate,
  listAllSends,
  listAllTemplates,
  send,
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
    expect(result).toEqual({ ok: true, send_id: expect.any(String), recipient_count: 2 });

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
});
