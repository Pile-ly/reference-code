// All club data, in one store the three screens share — and the home of
// the CLIENT-SIDE CASCADE (records and blobs never cascade on their own:
// deleting an event deletes its RSVP rows and its cover blob).
//
// Data flow, and note that the two tables load on DIFFERENT triggers,
// because they have opposite audiences:
//
//   loadEvents()  every visitor, signed in or not — `events` is
//                 anon-readable, so this is the call that renders the home
//                 page for a signed-out stranger.
//   loadRsvps()   the host only, from /admin — for anyone else the empty
//                 read group answers the uniform 404. The guest screens
//                 never call it; a guest's own answer comes from the
//                 per-device memo (lib/device_memo.ts), never the server.
//
// Mutations write through simple_db/simple_blob first, then patch the
// local arrays with the SERVER's answer: the server-minted fields (`id`,
// `_created_at_ms`) exist only on the returned record, so echoing locally
// without the round trip is never correct.
//
// The delete invariant, inherited from the plant tracker: RECORD FIRST,
// BLOB SECOND. A failure between the two orphans a blob — invisible,
// quota-only damage, findable with simple-blob's /list — while the reverse
// order could leave a live record pointing at a hard-deleted blob, which
// is a permanently broken screen. Deletes tolerate 404s so a retry
// converges.

import { create } from "zustand";
import { deleteBlob, uploadCover } from "../lib/blob";
import {
  type ClubTable,
  DbError,
  type EventRecord,
  type Fields,
  type RsvpRecord,
  type RsvpStatus,
  SimpleDb,
} from "../lib/db";
import { localZone } from "../lib/time";

/** Record delete where "already gone" (uniform 404) counts as success. */
async function removeRecord(table: ClubTable, id: string): Promise<void> {
  try {
    await SimpleDb.remove(table, id);
  } catch (e) {
    if (!(e instanceof DbError && e.status === 404)) throw e;
  }
}

/** Blob delete AFTER its record is gone: non-fatal by design (see the
 *  invariant above) — note the orphan and move on. */
async function removeBlobBestEffort(blobId: string): Promise<void> {
  if (!blobId) return;
  try {
    await deleteBlob(blobId);
  } catch (e) {
    console.warn("event_rsvp: orphaned blob (its record is already gone)", blobId, e);
  }
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

interface EventState {
  /** Every event, unsorted (screens sort). Null = not loaded yet. */
  events: EventRecord[] | null;
  /** Every RSVP row, host-only. Null = not loaded (or not permitted). */
  rsvps: RsvpRecord[] | null;
  loading: boolean;
  loadError: string | null;

  loadEvents: () => Promise<void>;
  loadRsvps: () => Promise<void>;

  /** Guest action. Always a CREATE — a submitter may not update their own
   *  row, so changing an answer appends another one. */
  sendRsvp: (input: {
    eventId: string;
    status: RsvpStatus;
    party: number;
    note: string;
  }) => Promise<RsvpRecord>;

  /** Host action. `coverBlob` is a downscaled JPEG to upload, or null to
   *  keep whatever the event already has. */
  createEvent: (input: EventInput, coverBlob: Blob | null) => Promise<EventRecord>;
  updateEvent: (
    event: EventRecord,
    input: EventInput,
    coverBlob: Blob | null,
  ) => Promise<EventRecord>;
  setCanceled: (event: EventRecord, canceled: boolean) => Promise<void>;
  /** Cascade: the event's RSVP rows → the event record → its cover blob. */
  deleteEvent: (event: EventRecord) => Promise<void>;
}

export const useEventStore = create<EventState>((set, get) => ({
  events: null,
  rsvps: null,
  loading: false,
  loadError: null,

  loadEvents: async () => {
    if (get().loading) return;
    set({ loading: true, loadError: null });
    try {
      const events = await SimpleDb.listAll<EventRecord>("events");
      set({ events, loading: false });
    } catch (e) {
      // A 404 here is the uniform denial OR a genuinely missing table —
      // indistinguishable by design, and neither means "signed out". The
      // page shows an empty/failed state; sign-in UI is driven by
      // `user()`, never by this.
      set({ loading: false, loadError: e instanceof Error ? e.message : String(e) });
    }
  },

  loadRsvps: async () => {
    try {
      const rsvps = await SimpleDb.listAll<RsvpRecord>("rsvps");
      set({ rsvps });
    } catch (e) {
      // For anyone but the host this is the uniform 404 — expected, and
      // the portal is owner-gated anyway. Keep it out of loadError so a
      // stray call cannot blank the events list.
      set({ rsvps: [] });
      if (!(e instanceof DbError && e.status === 404)) throw e;
    }
  },

  sendRsvp: async ({ eventId, status, party, note }) => {
    const fields: Fields = {
      event_id: eventId,
      status,
      // A "can't" row carries no heads — the roll-up sums party over
      // "going" rows only, and 0 keeps that sum honest either way.
      party: status === "going" ? party : 0,
      note,
    };
    const record = await SimpleDb.create<RsvpRecord>("rsvps", fields);
    // Patch the local list only if we are the host and already hold it;
    // a guest never has one to patch.
    set((s) => (s.rsvps ? { rsvps: [record, ...s.rsvps] } : {}));
    return record;
  },

  createEvent: async (input, coverBlob) => {
    const coverId = coverBlob ? await uploadCover(coverBlob, input.title || "event cover") : "";
    let record: EventRecord;
    try {
      record = await SimpleDb.create<EventRecord>("events", {
        title: input.title,
        starts_at_ms: input.startsAtMs,
        tz: localZone(),
        place: input.place,
        description: input.description,
        cover_blob_id: coverId,
        canceled: false,
      });
    } catch (e) {
      // The record never landed, so nothing points at the blob we just
      // uploaded — clean it up rather than leak the host's quota.
      await removeBlobBestEffort(coverId);
      throw e;
    }
    set((s) => ({ events: [...(s.events ?? []), record] }));
    return record;
  },

  updateEvent: async (event, input, coverBlob) => {
    const newCoverId = coverBlob ? await uploadCover(coverBlob, input.title || "event cover") : "";
    let record: EventRecord;
    try {
      record = await SimpleDb.update<EventRecord>("events", event.id, {
        title: input.title,
        starts_at_ms: input.startsAtMs,
        place: input.place,
        description: input.description,
        // Blob content is immutable, so "replace the cover" is a new blob
        // + this pointer swap. `tz` is deliberately not resent: the event
        // keeps the zone it was created in.
        ...(newCoverId ? { cover_blob_id: newCoverId } : {}),
      });
    } catch (e) {
      await removeBlobBestEffort(newCoverId);
      throw e;
    }
    // Only now is the old cover unreferenced.
    if (newCoverId) await removeBlobBestEffort(event.cover_blob_id);
    set((s) => ({
      events: (s.events ?? []).map((e) => (e.id === record.id ? record : e)),
    }));
    return record;
  },

  setCanceled: async (event, canceled) => {
    const record = await SimpleDb.update<EventRecord>("events", event.id, { canceled });
    set((s) => ({ events: (s.events ?? []).map((e) => (e.id === record.id ? record : e)) }));
  },

  deleteEvent: async (event) => {
    // Re-list server-side rather than trusting the loaded array: `eq` sees
    // rows written since this page loaded, which is exactly the case that
    // would otherwise strand guests' answers.
    const rows = await SimpleDb.listAll<RsvpRecord>("rsvps", { event_id: event.id });
    for (const row of rows) await removeRecord("rsvps", row.id);
    await removeRecord("events", event.id);
    await removeBlobBestEffort(event.cover_blob_id);
    set((s) => ({
      events: (s.events ?? []).filter((e) => e.id !== event.id),
      rsvps: (s.rsvps ?? []).filter((r) => r.event_id !== event.id),
    }));
  },
}));
