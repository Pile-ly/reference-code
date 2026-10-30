import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The flag is off for this whole file: whatever the shell exported, the
// modules below load with the variable unset.
vi.hoisted(() => {
  vi.stubEnv("VITE_PILELY_MOCK", undefined);
});

import { assertPilelyRuntime } from "../assert.js";
import { appId, serviceOrigin } from "../runtime.js";
import { resetMock, seedMock } from "./control.js";
import { isMockMode } from "./flag.js";

let getItem: ReturnType<typeof vi.fn>;
let setItem: ReturnType<typeof vi.fn>;
let removeItem: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getItem = vi.fn(() => null);
  setItem = vi.fn();
  removeItem = vi.fn();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem, setItem, removeItem };
  (globalThis as { window?: unknown }).window = {};
});

afterEach(() => {
  vi.stubEnv("VITE_PILELY_MOCK", undefined);
  delete (globalThis as { localStorage?: unknown }).localStorage;
  delete (globalThis as { window?: unknown }).window;
});

describe("with the flag off", () => {
  it.each([
    ["unset", undefined],
    ["empty", ""],
    ["true", "true"],
    ["0", "0"],
    ["yes", "yes"],
  ])("reads %s as off", (_label, value) => {
    vi.stubEnv("VITE_PILELY_MOCK", value);
    expect(isMockMode()).toBe(false);
  });

  it("never constructs the mock runtime: no window.pilely, no store read", () => {
    expect(() => serviceOrigin("simple-db")).toThrow(/pilely client not loaded/);
    expect(() => appId()).toThrow(/pilely client not loaded/);
    expect((globalThis as { window?: { pilely?: unknown } }).window?.pilely).toBeUndefined();
    expect(getItem).not.toHaveBeenCalled();
  });

  it("seedMock and resetMock are no-ops", () => {
    seedMock({ signedIn: true, tables: { posts: [{ title: "x" }] } });
    resetMock();
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).not.toHaveBeenCalled();
    expect((globalThis as { window?: { pilely?: unknown } }).window?.pilely).toBeUndefined();
  });

  it("assertPilelyRuntime still demands client.js", () => {
    expect(() => assertPilelyRuntime()).toThrow(/window\.pilely is not present/);
  });
});
