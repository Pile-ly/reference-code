import { describe, expect, it } from "vitest";

import { readMins, timeAgo } from "./time";

describe("readMins", () => {
  it("never reports zero", () => {
    expect(readMins("")).toBe(1);
    expect(readMins("a few words only")).toBe(1);
  });

  it("scales with word count (~220 wpm)", () => {
    const words = Array.from({ length: 660 }, () => "word").join(" ");
    expect(readMins(words)).toBe(3);
  });
});

describe("timeAgo", () => {
  const now = 1_700_000_000_000;

  it("compact buckets under a week", () => {
    expect(timeAgo(now - 30_000, now)).toBe("now");
    expect(timeAgo(now - 5 * 60_000, now)).toBe("5m");
    expect(timeAgo(now - 2 * 3_600_000, now)).toBe("2h");
    expect(timeAgo(now - 3 * 86_400_000, now)).toBe("3d");
  });

  it("falls back to the absolute date after a week", () => {
    expect(timeAgo(now - 8 * 86_400_000, now, "en")).toMatch(/\d{4}/);
  });
});
