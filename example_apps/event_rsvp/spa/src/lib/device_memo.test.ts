import { beforeEach, describe, expect, it } from "vitest";

import { clearMemo, type MemoStorage, readMemo, writeMemo } from "./device_memo";

function fakeStorage(): MemoStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("device memo", () => {
  let store: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    store = fakeStorage();
  });

  it("round-trips an answer", () => {
    writeMemo("maya_r", "ev1", { status: "going", party: 2, at: 1000 }, store);
    expect(readMemo("maya_r", "ev1", store)).toEqual({ status: "going", party: 2, at: 1000 });
  });

  it("is per handle — two accounts on one device never cross-read", () => {
    writeMemo("maya_r", "ev1", { status: "going", party: 2, at: 1000 }, store);
    expect(readMemo("jtan", "ev1", store)).toBeNull();
  });

  it("is per event", () => {
    writeMemo("maya_r", "ev1", { status: "cant", party: 0, at: 1000 }, store);
    expect(readMemo("maya_r", "ev2", store)).toBeNull();
  });

  it("overwrites on a changed answer — the memo mirrors the LATEST send", () => {
    writeMemo("maya_r", "ev1", { status: "going", party: 3, at: 1000 }, store);
    writeMemo("maya_r", "ev1", { status: "cant", party: 0, at: 2000 }, store);
    expect(readMemo("maya_r", "ev1", store)).toEqual({ status: "cant", party: 0, at: 2000 });
  });

  it("clears", () => {
    writeMemo("maya_r", "ev1", { status: "going", party: 1, at: 1000 }, store);
    clearMemo("maya_r", "ev1", store);
    expect(readMemo("maya_r", "ev1", store)).toBeNull();
  });

  it("treats a corrupt or foreign entry as absent", () => {
    store.map.set("event_rsvp:memo:maya_r:ev1", "{not json");
    expect(readMemo("maya_r", "ev1", store)).toBeNull();
    store.map.set("event_rsvp:memo:maya_r:ev2", JSON.stringify({ status: "maybe" }));
    expect(readMemo("maya_r", "ev2", store)).toBeNull();
  });

  it("no-ops without a signed-in handle or a storage", () => {
    expect(readMemo("", "ev1", store)).toBeNull();
    expect(() => writeMemo("", "ev1", { status: "going", party: 1, at: 1 }, store)).not.toThrow();
    expect(store.map.size).toBe(0);
    expect(readMemo("maya_r", "ev1", null)).toBeNull();
    expect(() =>
      writeMemo("maya_r", "ev1", { status: "going", party: 1, at: 1 }, null),
    ).not.toThrow();
  });
});
