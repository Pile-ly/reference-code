import { describe, expect, it } from "vitest";

import { fmtAgo, fmtSince, fmtWhen } from "./time";

const now = 1_700_000_000_000;
const H = 3600e3;
const D = 24 * H;

describe("fmtAgo (the UX spec's elapsed-hours buckets)", () => {
  it("under 24h is today", () => {
    expect(fmtAgo(now, now)).toEqual({ kind: "today" });
    expect(fmtAgo(now - 23 * H, now)).toEqual({ kind: "today" });
  });

  it("24–48h is yesterday — 25h AND 47h ago both", () => {
    expect(fmtAgo(now - 25 * H, now)).toEqual({ kind: "yesterday" });
    expect(fmtAgo(now - 47 * H, now)).toEqual({ kind: "yesterday" });
  });

  it("2+ elapsed days are N days ago", () => {
    expect(fmtAgo(now - 2 * D, now)).toEqual({ kind: "daysAgo", days: 2 });
    expect(fmtAgo(now - 12 * D, now)).toEqual({ kind: "daysAgo", days: 12 });
  });

  it("a future timestamp clamps to today (clock skew)", () => {
    expect(fmtAgo(now + H, now)).toEqual({ kind: "today" });
  });
});

describe("fmtWhen", () => {
  it("renders 'Www, Mmm D · time' in a fixed locale", () => {
    // 2023-11-14T22:13:20Z — assert shape, not the exact clock (the test
    // host's timezone shifts the rendered hour).
    expect(fmtWhen(now, "en-US")).toMatch(/^[A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2} · \d{1,2}:\d{2}/);
  });
});

describe("fmtSince", () => {
  it("renders 'Mmm YYYY'", () => {
    expect(fmtSince(now, "en-US")).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
  });
});
