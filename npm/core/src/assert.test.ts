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
  delete (globalThis as { Node?: unknown }).Node;
});

describe("assertPilelyRuntime", () => {
  it("throws when window.pilely is absent", () => {
    (globalThis as { window?: unknown }).window = {};
    expect(() => assertPilelyRuntime()).toThrow(/window\.pilely is not present/);
  });

  it("does NOT throw when the pilely-app meta tag is missing entirely (the tag is optional)", () => {
    (globalThis as { window?: unknown }).window = { pilely: stubClient };
    (globalThis as { document?: unknown }).document = {
      querySelector: (selector: string) =>
        selector.startsWith("meta") ? null : { tagName: "SCRIPT" },
    };
    expect(() => assertPilelyRuntime()).not.toThrow();
  });

  it("throws when the meta tag is present but the client.js script tag is missing", () => {
    (globalThis as { window?: unknown }).window = { pilely: stubClient };
    (globalThis as { document?: unknown }).document = {
      querySelector: (selector: string) =>
        selector.startsWith("meta") ? { tagName: "META" } : null,
    };
    expect(() => assertPilelyRuntime()).toThrow(/client\.js was found/);
  });

  it("does not throw when the tag is present and sits above the script (ordering still checked when present)", () => {
    (globalThis as { window?: unknown }).window = { pilely: stubClient };
    (globalThis as { Node?: unknown }).Node = { DOCUMENT_POSITION_FOLLOWING: 4 };
    (globalThis as { document?: unknown }).document = {
      querySelector: (selector: string) =>
        selector.startsWith("meta")
          ? { tagName: "META", compareDocumentPosition: () => 4 }
          : { tagName: "SCRIPT" },
    };
    expect(() => assertPilelyRuntime()).not.toThrow();
  });

  it("still throws when the tag is present but sits BELOW the client.js script", () => {
    (globalThis as { window?: unknown }).window = { pilely: stubClient };
    (globalThis as { Node?: unknown }).Node = { DOCUMENT_POSITION_FOLLOWING: 4 };
    (globalThis as { document?: unknown }).document = {
      querySelector: (selector: string) =>
        selector.startsWith("meta")
          ? { tagName: "META", compareDocumentPosition: () => 2 } // PRECEDING, not FOLLOWING
          : { tagName: "SCRIPT" },
    };
    expect(() => assertPilelyRuntime()).toThrow(/must sit ABOVE/);
  });
});
