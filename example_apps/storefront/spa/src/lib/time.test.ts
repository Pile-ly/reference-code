import { describe, expect, it } from "vitest";

import { timeAgo } from "./time";

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
