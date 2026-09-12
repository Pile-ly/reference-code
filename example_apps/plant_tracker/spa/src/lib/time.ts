// Small pure helpers over the server-minted `_created_at_ms` timestamps.
// Pure functions on purpose — they are unit-tested in time.test.ts; the
// i18n rendering of `fmtAgo` lives in `agoLabel` so the buckets stay
// locale-free and testable.

const DAY_MS = 24 * 3600e3;

export type Ago =
  | { kind: "today" }
  | { kind: "yesterday" }
  | { kind: "daysAgo"; days: number };

/** The UX spec's coarse buckets, elapsed-hours based (25h ago and 47h ago
 *  are both "yesterday"): today / yesterday / N days ago. */
export function fmtAgo(ms: number, now: number = Date.now()): Ago {
  const days = Math.floor(Math.max(0, now - ms) / DAY_MS);
  if (days === 0) return { kind: "today" };
  if (days === 1) return { kind: "yesterday" };
  return { kind: "daysAgo", days };
}

/** Render an Ago through i18n. Structural `t` type so this file never
 *  imports i18next (stays pure + node-testable). */
export function agoLabel(
  t: (key: string, opts?: Record<string, unknown>) => string,
  ms: number,
  now: number = Date.now(),
): string {
  const ago = fmtAgo(ms, now);
  switch (ago.kind) {
    case "today":
      return t("time.today");
    case "yesterday":
      return t("time.yesterday");
    case "daysAgo":
      return t("time.daysAgo", { count: ago.days });
  }
}

/** "Tue, Aug 5 · 9:14 AM" — a history entry's header, in the visitor's
 *  locale. */
export function fmtWhen(ms: number, locale?: string): string {
  const d = new Date(ms);
  const date = new Intl.DateTimeFormat(locale, {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  return `${date} · ${time}`;
}

/** "Aug 2026" — the hero's "since" date. */
export function fmtSince(ms: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { month: "short", year: "numeric" }).format(
    new Date(ms),
  );
}
