import { describe, expect, it } from "vitest";

import { avgGapDays } from "./stats";

const D = 24 * 3600e3;
const now = 1_700_000_000_000;

describe("avgGapDays", () => {
  it("needs at least two waterings", () => {
    expect(avgGapDays([])).toBeNull();
    expect(avgGapDays([now])).toBeNull();
  });

  it("matches the UX demo's seed math (waterings at −2d, −7d, −12d → 5d)", () => {
    expect(avgGapDays([now - 2 * D, now - 7 * D, now - 12 * D])).toBe(5);
  });

  it("rounds the mean of consecutive gaps to whole days", () => {
    // gaps of 3d and 4d → 3.5 → 4
    expect(avgGapDays([now, now - 3 * D, now - 7 * D])).toBe(4);
  });
});
