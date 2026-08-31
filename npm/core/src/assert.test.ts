import { afterEach, describe, expect, it, vi } from "vitest";
import { assertPilelyRuntime } from "./assert.js";
import type { PilelyClient } from "./types.js";

const stubClient: PilelyClient = {
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
};

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
});

describe("assertPilelyRuntime", () => {
  it("throws when window.pilely is absent", () => {
    (globalThis as { window?: unknown }).window = {};
    expect(() => assertPilelyRuntime()).toThrow(/window\.pilely is not present/);
  });

  it("throws when the pilely-app meta tag is missing", () => {
    (globalThis as { window?: unknown }).window = { pilely: stubClient };
    (globalThis as { document?: unknown }).document = {
      querySelector: (selector: string) =>
        selector.startsWith("meta") ? null : { tagName: "SCRIPT" },
    };
    expect(() => assertPilelyRuntime()).toThrow(/pilely-app.*missing/);
  });

  it("throws when the client.js script tag is missing", () => {
    (globalThis as { window?: unknown }).window = { pilely: stubClient };
    (globalThis as { document?: unknown }).document = {
      querySelector: (selector: string) =>
        selector.startsWith("meta") ? { tagName: "META" } : null,
    };
    expect(() => assertPilelyRuntime()).toThrow(/client\.js was found/);
  });
});
