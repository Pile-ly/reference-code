// The tracker's two simple_db tables, as record types (manual:
// https://pilely.app/skill/app_management/simple_db; tables and access set
// up in build_instruction.md).
//
// Contract points the `@pilely/simple-db` hooks already handle, worth
// knowing when reading these types:
//
//  1. WRITES NEST, READS ARE FLAT. A write sends the columns; the record
//     comes back with them at the TOP LEVEL, beside `id` and the
//     `_`-prefixed server-minted fields (`DbRecord`).
//  2. LISTS ARE PAGED, NEWEST FIRST. `useRecords` loads one page at a time;
//     any other order (the plant grid is creation order) is a client sort
//     over the loaded rows.
//  3. EVERY DENIAL IS A UNIFORM 404 — byte-identical to "no such table".
//     On this PRIVATE app that is the entire non-owner experience: a
//     signed-in stranger's first list 404s exactly like a nonexistent app.
//     The UI never reads sign-in state out of it (it gates on
//     `usePilelyAuth().user` — see components/SignInGate.tsx).
//
// Columns are all `text`. Every declared column is always sent and `""`
// means absent — a one-tap watering is `{plant_id, note: "", photo_blob_id:
// ""}`. Records store BLOB IDS only; download URLs are minted per render
// and expire (see components/BlobImage.tsx). All timestamps are the
// server's `_created_at_ms` — the app declares no date column anywhere.

import type { DbRecord } from "@pilely/simple-db";

/** The columns of one `plants` record. A type alias (not an interface), so
 *  it also fits `seedMock`'s row type. */
export type PlantFields = {
  name: string;
  /** simple_blob nanoid of the cover photo, or "" for the generated portrait. */
  photo_blob_id: string;
};

export interface PlantRecord extends DbRecord, PlantFields {}

export interface WateringRecord extends DbRecord {
  /** `id` of the `plants` record this watering belongs to. */
  plant_id: string;
  note: string;
  photo_blob_id: string;
}

/** Grid order: CREATION order (a new plant appends at the end) — an
 *  explicit ascending sort over the newest-first pages, so it stays
 *  obviously correct however many pages are loaded. */
export function byCreation(plants: PlantRecord[]): PlantRecord[] {
  return [...plants].sort((a, b) => a._created_at_ms - b._created_at_ms);
}

/** Stable placeholder-tint index for a record without a photo — hashing
 *  the id gives the same tint on every render without storing one. */
export function tintOf(id: string): number {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum = (sum + id.charCodeAt(i)) % 4;
  return sum;
}
