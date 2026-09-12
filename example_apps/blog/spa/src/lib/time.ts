// Small pure helpers over the server-minted `_created_at_ms` timestamps.
// Pure functions on purpose — they are unit-tested in time.test.ts.

/** "Aug 8, 2026" in the visitor's locale. */
export function formatDate(ms: number, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(ms));
}

/** Compact relative age for comment bylines: "now", "5m", "2h", "3d";
 *  falls back to the absolute date after a week. */
export function timeAgo(ms: number, now: number = Date.now(), locale?: string): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return "now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return formatDate(ms, locale);
}

/** Estimated reading minutes for a markdown body (~220 wpm, min 1). */
export function readMins(bodyMd: string): number {
  const words = bodyMd.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 220));
}
