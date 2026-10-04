// The club's two simple_db tables, as record types (manual:
// https://pilely.app/skill/app_management/simple_db; access set up in
// build_instruction.md).
//
// This app is the two-sided shape, and the two tables are mirror images of
// each other — that is the pattern worth copying:
//
//   events   read_group: null + anon_read: true   write_group: empty group
//            → the host publishes, the WHOLE WORLD reads (signed out too)
//   rsvps    read_group: empty group              write_group: null
//            → any signed-in guest writes, ONLY the host reads
//
// Contract points the `@pilely/simple-db` hooks already handle, worth
// knowing when reading these types:
//
//  1. WRITES NEST, READS ARE FLAT. A write sends the columns; the record
//     comes back with them at the TOP LEVEL, beside `id` and the
//     `_`-prefixed server-minted fields (`DbRecord`).
//  2. LISTS ARE PAGED, NEWEST FIRST. `useRecords` loads one page at a time;
//     any other order (these screens sort by `starts_at_ms`) is a client
//     sort over the loaded rows.
//  3. AN RSVP CAN ONLY EVER BE CREATED. Updating or deleting a record is
//     the DB OWNER's alone — a guest cannot edit the row they submitted.
//     So "change my RSVP" is a second create, and the host portal keeps
//     the latest row per `_submitter_handle` (lib/rollup.ts).
//  4. EVERY DENIAL IS A UNIFORM 404 — byte-identical to "no such table".
//     A guest listing `rsvps` gets one. Never read a 404 as proof that
//     something is missing, and never as "not signed in": UI gates on
//     `usePilelyAuth().user`.
//
// Columns are typed, not all-`text`: simple_db supports
// `text | integer | real | boolean | json` and round-trips them as real
// JSON values, so `starts_at_ms` arrives as a number and `canceled` as a
// boolean — no parsing in the screens.

import type { DbRecord } from "@pilely/simple-db";

/** The columns of one `events` record — what the host's form writes. A
 *  type alias (not an interface), so it also fits `seedMock`'s row type. */
export type EventFields = {
  title: string;
  /** Epoch ms of the start — an `integer` column, so it sorts and splits. */
  starts_at_ms: number;
  /** IANA zone the host created it in; every render formats in this zone. */
  tz: string;
  place: string;
  description: string;
  /** simple_blob nanoid of the cover, or "" for the generative art. */
  cover_blob_id: string;
  /** A `boolean` column. Canceled events keep their history and their
   *  RSVPs; they simply render as canceled. */
  canceled: boolean;
};

export interface EventRecord extends DbRecord, EventFields {}

export type RsvpStatus = "going" | "cant";

export interface RsvpRecord extends DbRecord {
  /** The `events` record id this answers. */
  event_id: string;
  status: RsvpStatus;
  /** Heads including the sender; always 0 on a `cant` row. */
  party: number;
  /** Optional note to the host; "" when skipped. */
  note: string;
}

/** What the host's form collects. `startsAtMs` comes from the
 *  datetime-local input via lib/time.ts; `tz` is stamped at create time
 *  and then left alone, so editing from another zone never silently moves
 *  the event. */
export interface EventInput {
  title: string;
  startsAtMs: number;
  place: string;
  description: string;
}

/** Upcoming soonest-first (the next dinner is the point of the page). */
export function bySoonest(events: EventRecord[]): EventRecord[] {
  return [...events].sort((a, b) => a.starts_at_ms - b.starts_at_ms);
}

/** Latest start first — past events, and the host's own list. */
export function byLatest(events: EventRecord[]): EventRecord[] {
  return [...events].sort((a, b) => b.starts_at_ms - a.starts_at_ms);
}
