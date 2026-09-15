import { afterEach, describe, expect, it, vi } from "vitest";
import type { PilelyClient } from "@pilely/core";
import { PilelyError } from "@pilely/core";
import { createPolicy, disablePolicy, listAllPolicies, listPolicies } from "./index.js";
import type { PolicyInput } from "./types.js";

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

const input: PolicyInput = {
  name: "inquiry form",
  host: "simple-db.pilely.app",
  method: "POST",
  path: "/apps/p1/tables/inquiries/records/create",
  key: "user",
  strategy: { type: "fixed_window", limit: 5, window_secs: 60 },
};

const policy = {
  id: "abc12345",
  ...input,
  created_at: 1,
  disabled_at: null,
};

describe("createPolicy", () => {
  it("posts to /policies/create and returns the flat policy", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, policy));
    stubWindow(fetchImpl);
    const result = await createPolicy(input);
    expect(urlOf(fetchImpl)).toBe("https://simple-limiter.pilely.app/policies/create");
    expect(bodyOf(fetchImpl)).toEqual(input);
    expect(result).toEqual(policy);
  });

  it("surfaces a rejected create as a PilelyError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(400, { ok: false, code: "unsupported_host", reason: "unsupported host" }),
    );
    stubWindow(fetchImpl);
    await expect(createPolicy(input)).rejects.toMatchObject({
      status: 400,
      code: "unsupported_host",
    });
    await expect(createPolicy(input)).rejects.toBeInstanceOf(PilelyError);
  });
});

describe("listPolicies / listAllPolicies", () => {
  it("posts to /policies/list sending only the set keyset keys", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { policies: [], next_cursor: null }));
    stubWindow(fetchImpl);
    await listPolicies({ limit: 10 });
    expect(urlOf(fetchImpl)).toBe("https://simple-limiter.pilely.app/policies/list");
    expect(Object.keys(bodyOf(fetchImpl))).toEqual(["limit"]);
  });

  it("listAllPolicies walks the after_created_at/after_id cursor sending limit: 100", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          policies: [{ ...policy, id: "p1" }],
          next_cursor: { after_created_at: 1, after_id: "p1" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { policies: [{ ...policy, id: "p2" }], next_cursor: null }),
      );
    stubWindow(fetchImpl);
    const rows = await listAllPolicies();
    expect(rows.map((r) => r.id)).toEqual(["p1", "p2"]);
    for (const call of fetchImpl.mock.calls) {
      const init = call[1] as RequestInit;
      expect(JSON.parse(init.body as string).limit).toBe(100);
    }
  });
});

describe("disablePolicy", () => {
  it("posts to /policies/{id}/disable and returns the updated policy", async () => {
    const disabled = { ...policy, disabled_at: 2 };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, disabled));
    stubWindow(fetchImpl);
    const result = await disablePolicy("abc12345");
    expect(urlOf(fetchImpl)).toBe("https://simple-limiter.pilely.app/policies/abc12345/disable");
    expect(result.disabled_at).toBe(2);
  });

  it("a second disable surfaces the 409 as a PilelyError", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(409, { ok: false, code: "already_disabled", reason: "policy already disabled" }),
    );
    stubWindow(fetchImpl);
    await expect(disablePolicy("abc12345")).rejects.toMatchObject({
      status: 409,
      code: "already_disabled",
    });
  });
});
