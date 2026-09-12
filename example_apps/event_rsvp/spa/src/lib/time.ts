// Event time: the one part of this app that is real logic rather than
// platform plumbing. Pure functions on purpose — unit-tested in
// time.test.ts.
//
// The model, in one paragraph. An event record carries `starts_at_ms` (an
// epoch-millisecond INTEGER column) and `tz` (the IANA zone the host was
// in when they created it, e.g. "America/Los_Angeles"). Every render
// formats the instant IN THAT ZONE: a 6:30 pm dinner in Oakland reads
// "6:30 pm PDT" to a guest in Tokyo too, because that is when to show up.
// The form is a single <input type="datetime-local">, whose value is a
// zone-less wall-clock string — `wallTimeInZone` / `wallTimeToMs` convert
// between that string and the stored instant, so editing an event from a
// different zone than it was created in still shows the host's time.
//
// Why not store a formatted string? Because "upcoming vs past" and the
// home page's ordering need a real instant. Why not store the browser's
// local time only? Because the visitor's zone is not the event's zone.

/**
 * How long after its start an event still counts as upcoming. An event
 * should not flip to "already happened" — closing RSVPs and greying out —
 * one minute after it starts, while guests are still arriving.
 */
export const EVENT_GRACE_MS = 3 * 60 * 60 * 1000;

/** The zone the browser is in — captured onto a new event as its `tz`. */
export function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Past = started more than EVENT_GRACE_MS ago. */
export function isPast(startsAtMs: number, now: number = Date.now()): boolean {
  return now > startsAtMs + EVENT_GRACE_MS;
}

/** The date badge on a card: { month: "AUG", day: "22" }, in the event's
 *  own zone. */
export function eventBadge(
  startsAtMs: number,
  tz: string,
  locale?: string,
): { month: string; day: string } {
  const at = new Date(startsAtMs);
  const month = new Intl.DateTimeFormat(locale, { month: "short", timeZone: zoneOr(tz) })
    .format(at)
    .toUpperCase();
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", timeZone: zoneOr(tz) }).format(at);
  return { month, day };
}

/** The full when-line: "Sat, Aug 22, 6:30 PM PDT" — weekday and zone
 *  included, because a guest reading it may be nowhere near the host. */
export function formatWhen(startsAtMs: number, tz: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: zoneOr(tz),
  }).format(new Date(startsAtMs));
}

/** The short when-line for a dense card: "Sat 6:30 PM · " without the date
 *  (the badge beside it already carries the date). */
export function formatShortWhen(startsAtMs: number, tz: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: zoneOr(tz),
  }).format(new Date(startsAtMs));
}

// ── datetime-local ⇄ instant ────────────────────────────────────────────

/**
 * The instant, written as the wall-clock string `<input
 * type="datetime-local">` wants ("2026-08-22T18:30"), AS READ IN `tz`.
 * Opening the edit form in Tokyo therefore shows the host's 6:30 pm, not
 * the visitor's 10:30 am.
 */
export function wallTimeInZone(ms: number, tz: string): string {
  const p = zonedParts(ms, zoneOr(tz));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** `2026-08-22T18:30`, optionally with seconds — what a datetime-local
 *  input emits. Matched explicitly because `Date.parse` is far too
 *  lenient to use as a validator: it reads `":00Z"` as the year 2000. */
const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * The inverse: a wall-clock string read IN `tz` → the epoch instant.
 *
 * There is no built-in for this, so we solve it: read the string as if it
 * were UTC, measure the zone's offset at that provisional instant, shift
 * by it, then re-measure once. The second pass matters only across a DST
 * boundary, where the first guess can land on the wrong side of the jump.
 * Returns NaN for an empty or half-typed input, so the form can refuse to
 * save rather than store a garbage instant.
 */
export function wallTimeToMs(wall: string, tz: string): number {
  const m = WALL_TIME.exec(wall.trim());
  if (!m) return NaN;
  const asUtc = Date.UTC(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
  );
  if (Number.isNaN(asUtc)) return NaN;
  const zone = zoneOr(tz);
  const firstGuess = asUtc - zoneOffsetMs(asUtc, zone);
  const offset = zoneOffsetMs(firstGuess, zone);
  return asUtc - offset;
}

// ── internals ───────────────────────────────────────────────────────────

/** A record written by an older/other client may carry an empty or unknown
 *  zone; Intl throws on those, so fall back to the viewer's own. */
function zoneOr(tz: string): string {
  if (!tz) return localZone();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return localZone();
  }
}

interface ZonedParts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

/** The instant's calendar fields as read in `tz`, zero-padded. `h23` keeps
 *  midnight at "00" (an `hour12: false` formatter can emit "24"). */
function zonedParts(ms: number, tz: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
    second: pick("second"),
  };
}

/** How far ahead of UTC `tz` is at this instant, in ms (negative west of
 *  Greenwich). Derived by formatting the instant in the zone and reading
 *  the result back as if it were UTC. */
function zoneOffsetMs(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  // Sub-second precision is irrelevant here (the input is minute-grained),
  // so drop it rather than let it skew the offset.
  return asUtc - Math.floor(ms / 1000) * 1000;
}
