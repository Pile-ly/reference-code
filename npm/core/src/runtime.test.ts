import { afterEach, describe, expect, it, vi } from "vitest";
import { appId, serviceOrigin } from "./runtime.js";
import type { PilelyClient } from "./types.js";

function stubWindow(overrides: Partial<PilelyClient>): void {
  (globalThis as { window?: unknown }).window = {
    pilely: {
      ready: Promise.resolve(true),
      isAppOrigin: () => true,
      apexOrigin: () => "https://pilely.app",
      user: () => null,
      claims: () => null,
      token: () => null,
      fetch: vi.fn(),
      appId: () => "app-1",
      signIn: vi.fn(),
      signOut: vi.fn(),
      takeReturnPath: () => null,
      ...overrides,
    },
  };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("serviceOrigin", () => {
  it("derives the service host from the apex client.js was loaded from", () => {
    stubWindow({ apexOrigin: () => "https://pilely.app" });
    expect(serviceOrigin("simple-db")).toBe("https://simple-db.pilely.app");
  });

  it("derives from a self-hosted apex, never a baked-in pilely.app", () => {
    stubWindow({ apexOrigin: () => "https://example.test" });
    expect(serviceOrigin("simple-blob")).toBe("https://simple-blob.example.test");
  });

  it("throws when window.pilely is absent", () => {
    expect(() => serviceOrigin("simple-db")).toThrow(/pilely client not loaded/);
  });

  it("rejects a service name outside the four reserved literals", () => {
    stubWindow({});
    expect(() => serviceOrigin("simple-payment" as never)).toThrow(/unknown service/);
  });
});

describe("appId", () => {
  it("delegates entirely to window.pilely.appId() and returns null as-is, never throwing", () => {
    // null (no tag, ready not settled) is a legitimate answer client.js's
    // own fallback produced — not this accessor's error to raise.
    stubWindow({ appId: () => null });
    expect(appId()).toBeNull();
  });

  it("returns whatever the client reports, unmodified", () => {
    stubWindow({ appId: () => "app-42" });
    expect(appId()).toBe("app-42");
  });
});
