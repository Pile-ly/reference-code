// The plant page's "avg gap" stat — mean of the consecutive intervals
// between waterings, in whole days (UX spec). Pure; tested in stats.test.ts.

const DAY_MS = 24 * 3600e3;

/**
 * `timestampsDesc` is a plant's watering `_created_at_ms` values, NEWEST
 * FIRST (the order the store keeps). Null when there are fewer than two
 * waterings — the UI renders "—".
 */
export function avgGapDays(timestampsDesc: number[]): number | null {
  if (timestampsDesc.length < 2) return null;
  let sum = 0;
  for (let i = 0; i < timestampsDesc.length - 1; i++) {
    sum += timestampsDesc[i] - timestampsDesc[i + 1];
  }
  return Math.round(sum / (timestampsDesc.length - 1) / DAY_MS);
}
