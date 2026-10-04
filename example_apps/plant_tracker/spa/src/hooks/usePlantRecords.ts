// The tracker's reads, one hook per view, shared by every screen that shows
// it. The same call is the same query key wherever it is used, and every
// write through the simple-db mutation hooks refreshes it.
//
//   usePlants()           the grid — every plant, newest-created page first
//                         (the screen sorts by creation).
//   usePlant(id)          one plant by record id — the deep-linkable page.
//   useWaterings(id)      one plant's history, newest first, server-filtered
//                         with `eq`; also what the delete cascade walks.
//   useLastWatering(id)   one row: the plant's most recent watering, for
//                         the card's "watered X ago".
//
// Lists ask for the service's page cap (100) and expose `hasNextPage` /
// `fetchNextPage` for a More control.

import { PilelyError } from "@pilely/core";
import { useRecord, useRecords } from "@pilely/simple-db";
import type { PlantRecord, WateringRecord } from "../lib/records";

const PAGE = 100;

export function usePlants() {
  return useRecords<PlantRecord>("plants", { limit: PAGE });
}

/** `data` is `undefined` for an id that is not there (an error then) or
 *  that was just deleted. */
export function usePlant(plantId: string) {
  return useRecord<PlantRecord>("plants", plantId);
}

export function useWaterings(plantId: string) {
  return useRecords<WateringRecord>("waterings", { eq: { plant_id: plantId }, limit: PAGE });
}

/** The newest watering of one plant, or null if it was never watered. The
 *  list is newest first, so the first row of a one-row page is the answer. */
export function useLastWatering(plantId: string): WateringRecord | null {
  const { data } = useRecords<WateringRecord>("waterings", { eq: { plant_id: plantId }, limit: 1 });
  return data?.[0] ?? null;
}

/** The uniform 404: denied, or not there — indistinguishable by design. On
 *  a list it means the whole table is denied (a non-owner, or a broken
 *  deploy); a filtered list of an existing table just answers no rows. */
export function isGone(e: unknown): boolean {
  return e instanceof PilelyError && e.status === 404;
}
