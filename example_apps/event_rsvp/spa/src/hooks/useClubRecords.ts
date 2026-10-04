// The club's reads, one hook per table, shared by every screen that shows
// it. Each call below is the same query key wherever it is used, so the
// home page and the host portal read one cache entry for `events`, and
// every write through the simple-db mutation hooks refreshes it.
//
// The two tables load for DIFFERENT audiences:
//
//   useEvents()  every visitor, signed in or not — `events` is
//                anon-readable, so this is the read that renders the home
//                page for a signed-out stranger.
//   useRsvps()   the host only, mounted inside the host portal — for anyone
//                else the empty read group answers the uniform 404. The
//                guest screens never call it; a guest's own answer comes
//                from the per-device memo (lib/device_memo.ts).
//
// Lists ask for the service's page cap (100) and expose `hasNextPage` /
// `fetchNextPage` for a More control; the service answers newest-created
// first, and the screens sort by `starts_at_ms` over the loaded rows.

import { useRecord, useRecords } from "@pilely/simple-db";
import type { EventRecord, RsvpRecord } from "../lib/records";

const PAGE = 100;

export function useEvents() {
  return useRecords<EventRecord>("events", { limit: PAGE });
}

/** One event by record id — the deep-linkable event page. `data` is
 *  `undefined` for an id that is not there (or was just deleted). */
export function useEvent(eventId: string) {
  return useRecord<EventRecord>("events", eventId);
}

/** Every RSVP row, across events. Mount for the host only: anyone else's
 *  read is the uniform 404. */
export function useRsvps() {
  return useRecords<RsvpRecord>("rsvps", { limit: PAGE });
}
