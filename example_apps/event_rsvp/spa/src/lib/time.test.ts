import { describe, expect, it } from "vitest";

import {
  EVENT_GRACE_MS,
  eventBadge,
  formatShortWhen,
  formatWhen,
  isPast,
  wallTimeInZone,
  wallTimeToMs,
} from "./time";

const LA = "America/Los_Angeles";
const TOKYO = "Asia/Tokyo";

// Sat 22 Aug 2026, 6:30 pm in Oakland (PDT = UTC-7).
const DINNER_MS = Date.UTC(2026, 7, 23, 1, 30);

describe("wallTimeToMs / wallTimeInZone", () => {
  it("reads a datetime-local value as wall time in the event's zone", () => {
    expect(wallTimeToMs("2026-08-22T18:30", LA)).toBe(DINNER_MS);
  });

  it("round-trips an instant back to the same wall time", () => {
    expect(wallTimeInZone(DINNER_MS, LA)).toBe("2026-08-22T18:30");
  });

  it("is anchored to the event's zone, not the viewer's", () => {
    // The same wall clock in Tokyo (JST = UTC+9) is a different instant —
    // which is the whole point of storing `tz` beside `starts_at_ms`.
    const tokyoDinner = wallTimeToMs("2026-08-22T18:30", TOKYO);
    expect(tokyoDinner).toBe(Date.UTC(2026, 7, 22, 9, 30));
    expect(wallTimeInZone(tokyoDinner, TOKYO)).toBe("2026-08-22T18:30");
    // Read in Oakland, that instant is a morning event.
    expect(wallTimeInZone(tokyoDinner, LA)).toBe("2026-08-22T02:30");
  });

  it("lands on the right side of a DST jump", () => {
    // US spring-forward 2026: 2:00 am PST → 3:00 am PDT on Mar 8.
    expect(wallTimeToMs("2026-03-08T01:00", LA)).toBe(Date.UTC(2026, 2, 8, 9, 0)); // PST, -8
    expect(wallTimeToMs("2026-03-08T09:00", LA)).toBe(Date.UTC(2026, 2, 8, 16, 0)); // PDT, -7
    expect(wallTimeInZone(Date.UTC(2026, 2, 8, 16, 0), LA)).toBe("2026-03-08T09:00");
  });

  it("keeps midnight at 00, never 24", () => {
    const midnight = wallTimeToMs("2026-08-22T00:00", LA);
    expect(wallTimeInZone(midnight, LA)).toBe("2026-08-22T00:00");
  });

  it("returns NaN for a half-typed input rather than a bogus instant", () => {
    expect(Number.isNaN(wallTimeToMs("", LA))).toBe(true);
    expect(Number.isNaN(wallTimeToMs("2026-08-2", LA))).toBe(true);
  });

  it("falls back to the viewer's zone for a missing or unknown tz", () => {
    // A record written by an older client, or a typo — must not throw.
    expect(() => wallTimeInZone(DINNER_MS, "")).not.toThrow();
    expect(() => wallTimeInZone(DINNER_MS, "Mars/Olympus_Mons")).not.toThrow();
  });
});

describe("eventBadge", () => {
  it("reads the date in the event's zone", () => {
    expect(eventBadge(DINNER_MS, LA, "en-US")).toEqual({ month: "AUG", day: "22" });
  });

  it("can differ from the viewer's calendar day", () => {
    // Same instant, read in Tokyo: already the 23rd.
    expect(eventBadge(DINNER_MS, TOKYO, "en-US")).toEqual({ month: "AUG", day: "23" });
  });
});

describe("formatWhen", () => {
  it("names the weekday, the time and the zone", () => {
    const when = formatWhen(DINNER_MS, LA, "en-US");
    expect(when).toContain("Sat");
    expect(when).toContain("Aug 22");
    expect(when).toContain("6:30");
    expect(when).toContain("PDT");
  });

  it("drops the date for the card line", () => {
    const short = formatShortWhen(DINNER_MS, LA, "en-US");
    expect(short).toContain("Sat");
    expect(short).toContain("6:30");
    expect(short).not.toContain("Aug");
  });
});

describe("isPast", () => {
  it("stays upcoming while the event is still running", () => {
    expect(isPast(DINNER_MS, DINNER_MS - 60_000)).toBe(false);
    expect(isPast(DINNER_MS, DINNER_MS)).toBe(false);
    expect(isPast(DINNER_MS, DINNER_MS + EVENT_GRACE_MS - 1)).toBe(false);
  });

  it("is past once the grace window has elapsed", () => {
    expect(isPast(DINNER_MS, DINNER_MS + EVENT_GRACE_MS + 1)).toBe(true);
  });
});
