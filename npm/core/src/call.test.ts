import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { call, collectPages } from "./call.js";
import { PilelyError } from "./error.js";
import type { PilelyClient } from "./types.js";

function jsonResponse(status: number, body: unknown | null): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === null) throw new Error("no body");
      return body;
    },
  } as unknown as Response;
}

function stubWindow(fetchImpl: PilelyClient["fetch"], readyPromise?: Promise<boolean>): void {
  const client: PilelyClient = {
    ready: readyPromise ?? Promise.resolve(true),
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

let globalFetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  globalFetchSpy = vi.fn();
  (globalThis as { fetch?: unknown }).fetch = globalFetchSpy;
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { fetch?: unknown }).fetch;
});

describe("call", () => {
  it("normalizes a bare bodiless 404 into a PilelyError", async () => {
    stubWindow(vi.fn().mockResolvedValue(jsonResponse(404, null)));
    await expect(call({ service: "simple-db", path: "/x" })).rejects.toMatchObject({
      status: 404,
      code: null,
      reason: "simple-db answered 404",
    });
    await expect(call({ service: "simple-db", path: "/x" })).rejects.toBeInstanceOf(PilelyError);
  });

  it("normalizes an {ok:false, code, reason} envelope into a PilelyError", async () => {
    stubWindow(
      vi.fn().mockResolvedValue(
        jsonResponse(403, { ok: false, code: "not_a_member", reason: "not a group member" }),
      ),
    );
    await expect(call({ service: "simple-group", path: "/x" })).rejects.toMatchObject({
      status: 403,
      code: "not_a_member",
      reason: "not a group member",
    });
  });

  it("sets content-type application/json on the JSON path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    stubWindow(fetchImpl);
    await call({ service: "simple-db", path: "/x", body: { a: 1 } });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("sets no content-type on the FormData path", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    stubWindow(fetchImpl);
    const form = new FormData();
    await call({ service: "simple-blob", path: "/upload", form });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["content-type"]).toBeUndefined();
    expect(init.body).toBe(form);
  });

  it("awaits pilely.ready before invoking pilely.fetch", async () => {
    let resolveReady!: (v: boolean) => void;
    const readyPromise = new Promise<boolean>((resolve) => {
      resolveReady = resolve;
    });
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    stubWindow(fetchImpl, readyPromise);

    const pending = call({ service: "simple-db", path: "/x" });
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();

    resolveReady(true);
    await pending;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never touches global fetch", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    stubWindow(fetchImpl);
    await call({ service: "simple-db", path: "/x" });
    expect(globalFetchSpy).not.toHaveBeenCalled();
  });
});

describe("collectPages", () => {
  it("stops on a single, not-full page", async () => {
    const fetchPage = vi.fn().mockResolvedValue({ rows: [1, 2], nextCursor: null });
    const rows = await collectPages(fetchPage);
    expect(rows).toEqual([1, 2]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("walks a three-page listing to the end", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ rows: [1, 2], nextCursor: "a" })
      .mockResolvedValueOnce({ rows: [3, 4], nextCursor: "b" })
      .mockResolvedValueOnce({ rows: [5], nextCursor: null });
    const rows = await collectPages(fetchPage);
    expect(rows).toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenNthCalledWith(2, "a");
    expect(fetchPage).toHaveBeenNthCalledWith(3, "b");
  });
});
