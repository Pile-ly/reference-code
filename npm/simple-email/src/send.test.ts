import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// send.ts must load no browser runtime: were it to import either of these,
// importing it below would throw.
vi.mock("@pilely/core", () => {
  throw new Error("send.ts must not load @pilely/core");
});
vi.mock("react", () => {
  throw new Error("send.ts must not load react");
});

import { SIMPLE_EMAIL_ORIGIN, SendError, send } from "./send.js";
import type { SendInput, SendResult } from "./send.js";
import type { SimpleEmailErrorCode } from "./types.js";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === undefined) throw new Error("no body");
      return body;
    },
  } as unknown as Response;
}

const sent = { ok: true, send_id: "s1", recipient_count: 1, replayed: false };
const backend = { appId: "app-1", backendToken: "backend-token-1" };

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200, sent));
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function urlOf(): string {
  return String(fetchSpy.mock.calls[0]?.[0]);
}

function initOf(): RequestInit {
  return fetchSpy.mock.calls[0]?.[1] as RequestInit;
}

function bodyOf(): Record<string, unknown> {
  return JSON.parse(initOf().body as string);
}

describe("send: the freestyle send, for an app's backend", () => {
  it("posts to /accounts/{app_id}/send with the given Bearer token, and needs no window.pilely", async () => {
    expect((globalThis as { window?: unknown }).window).toBeUndefined();
    const result = await send({ to: ["a@x.test"], subject: "Hi", html: "<p>hi</p>" }, backend);
    expect(urlOf()).toBe("https://simple-email.pilely.app/accounts/app-1/send");
    const init = initOf();
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      authorization: "Bearer backend-token-1",
      accept: "application/json",
      "content-type": "application/json",
    });
    expect(bodyOf()).toEqual({ to: ["a@x.test"], subject: "Hi", html: "<p>hi</p>" });
    expect(result).toEqual({ send_id: "s1", recipient_count: 1, replayed: false });
  });

  it("loads without @pilely/core or React (both are mocked to throw above)", () => {
    expect(typeof send).toBe("function");
  });

  it("a template_id call produces a template body, carrying the variables", async () => {
    await send({ to: ["a@x.test"], template_id: "t1", variables: { name: "Ada" } }, backend);
    expect(bodyOf()).toEqual({ to: ["a@x.test"], template_id: "t1", variables: { name: "Ada" } });
  });

  it("neither a template_id nor a subject+html pair typechecks, nor a call without to", () => {
    // @ts-expect-error missing both template_id and subject/html
    const invalidNeither: SendInput = { to: ["a@x.test"] };
    void invalidNeither;
    // @ts-expect-error subject alone, no html
    const invalidPartial: SendInput = { to: ["a@x.test"], subject: "hi" };
    void invalidPartial;
    // @ts-expect-error to is required
    const noTo: SendInput = { template_id: "t1" };
    void noTo;
  });

  it("puts idempotency_key on the wire in both shapes, and leaves it off when not given", async () => {
    const shapes: SendInput[] = [
      { to: ["a@x.test"], subject: "s", html: "<p/>", idempotency_key: "k-inline" },
      { to: ["a@x.test"], template_id: "t1", idempotency_key: "confirm:row-1" },
    ];
    for (const input of shapes) {
      fetchSpy.mockClear();
      await send(input, backend);
      expect(bodyOf().idempotency_key).toBe(input.idempotency_key);
    }
    fetchSpy.mockClear();
    await send({ to: ["a@x.test"], subject: "s", html: "<p/>" }, backend);
    expect(bodyOf()).not.toHaveProperty("idempotency_key");
  });

  it("carries replayed in the result", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(200, { ok: true, send_id: "s-first", recipient_count: 2, replayed: true }));
    const result: SendResult = await send({ to: ["a@x.test", "b@x.test"], template_id: "t1", idempotency_key: "k" }, backend);
    expect(result).toEqual({ send_id: "s-first", recipient_count: 2, replayed: true });
  });

  it("uses the origin it is given, without a trailing slash", async () => {
    expect(SIMPLE_EMAIL_ORIGIN).toBe("https://simple-email.pilely.app");
    await send({ to: ["a@x.test"], subject: "s", html: "<p/>" }, { ...backend, origin: "https://simple-email.lane.test/" });
    expect(urlOf()).toBe("https://simple-email.lane.test/accounts/app-1/send");
  });

  it("throws SendError with the service's code on every refusal", async () => {
    for (const [status, code] of [
      [400, "bad_request"],
      [404, "not_found"],
      [409, "idempotency_key_reused"],
      [409, "idempotency_key_in_progress"],
      [429, "daily_cap_exceeded"],
      [500, "internal"],
    ] as [number, SimpleEmailErrorCode][]) {
      fetchSpy.mockResolvedValue(jsonResponse(status, { ok: false, code, reason: "r" }));
      const refusal = send({ to: ["a@x.test"], template_id: "t1", idempotency_key: "k" }, backend);
      await expect(refusal).rejects.toBeInstanceOf(SendError);
      await expect(refusal).rejects.toMatchObject({ status, code, reason: "r" });
    }
  });

  it("reads a bodiless refusal with a null code, and never puts the token in the error", async () => {
    fetchSpy.mockResolvedValue(jsonResponse(404, undefined));
    const error = await send({ to: ["a@x.test"], subject: "s", html: "<p/>" }, backend).catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 404, code: null });
    expect(JSON.stringify(error)).not.toContain("backend-token-1");
    expect(String((error as Error).message)).not.toContain("backend-token-1");
  });

  it("refuses to send without an app id or a backend token", async () => {
    await expect(send({ to: ["a@x.test"], subject: "s", html: "<p/>" }, { ...backend, appId: "" })).rejects.toMatchObject({
      status: 0,
      code: null,
    });
    await expect(
      send({ to: ["a@x.test"], subject: "s", html: "<p/>" }, { ...backend, backendToken: "" }),
    ).rejects.toMatchObject({ status: 0, code: null });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
