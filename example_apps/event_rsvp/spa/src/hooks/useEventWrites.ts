// The host's writes — and the home of the CLIENT-SIDE CASCADE (records and
// blobs never cascade on their own: deleting an event deletes its RSVP
// rows and its cover blob).
//
// Every step is a `mutateAsync` from the @pilely hooks, awaited in order, so
// each write refreshes the reads it affects on its own.
//
// Covers use simple_blob's PUBLIC shape, which is what makes signed-out
// visitors see them at all: upload with `read_group: null` AND
// `anon_read: true`.
//
//  - `anon_read` is per BLOB, never per app, and it is the only route by
//    which a signed-out visitor may fetch anything from simple_blob.
//  - It cannot coexist with a named `read_group` — if anyone may read, a
//    read group is meaningless, and sending both is a 400.
//  - It is live the moment you set it on a `public` app; on a
//    protected/private app no anonymous credential can exist, so it is
//    inert there (that is why the plant tracker uses an empty group
//    instead).
//
// The delete invariant: RECORD FIRST, BLOB SECOND. A failure between the
// two orphans a blob — invisible, quota-only damage, findable with
// simple-blob's /list — while the reverse order could leave a live record
// pointing at a hard-deleted blob, which is a permanently broken screen.
// Record deletes tolerate the uniform 404 so a retry converges; deleting a
// blob that is already gone counts as success in `useDeleteBlob` itself.

import { PilelyError, serviceQueryKey } from "@pilely/core";
import { useDeleteBlob, useUpload } from "@pilely/simple-blob";
import { useCreateRecord, useDeleteRecord, useUpdateRecord } from "@pilely/simple-db";
import { useQueryClient } from "@tanstack/react-query";
import type { EventInput, EventRecord, RsvpRecord } from "../lib/records";
import { localZone } from "../lib/time";
import type { useRsvps } from "./useClubRecords";

/** The uniform 404: denied, or already gone — indistinguishable by design,
 *  and both mean there is nothing left to delete. */
function isGone(e: unknown): boolean {
  return e instanceof PilelyError && e.status === 404;
}

/** Upload one downscaled JPEG as a PUBLIC cover; resolves with the
 *  `blob_nanoid` the event record stores. Only the host ever calls this:
 *  uploads are signed-in-only, and only the host can write `events`. */
function useUploadCover(): (jpeg: Blob, displayName: string) => Promise<string> {
  const upload = useUpload();
  return async (jpeg, displayName) => {
    const blob = await upload.mutateAsync({
      // A named file part, so the stored upload carries a real file name.
      file: new File([jpeg], "cover.jpg", { type: "image/jpeg" }),
      extension: "jpg",
      content_type: "image/jpeg",
      // The public-blob pair (see the header): no group, anonymous read on.
      read_group: null,
      anon_read: true,
      display_name: displayName,
    });
    return blob.blob_nanoid;
  };
}

/** Blob delete AFTER its record is gone: non-fatal by design (see the
 *  invariant above) — note the orphan and move on. */
function useRemoveBlobBestEffort(): (blobId: string) => Promise<void> {
  const deleteBlob = useDeleteBlob();
  return async (blobId) => {
    if (!blobId) return;
    try {
      await deleteBlob.mutateAsync(blobId);
    } catch (e) {
      console.warn("event_rsvp: orphaned blob (its record is already gone)", blobId, e);
    }
  };
}

/**
 * Create (no `event`) or update (`event`) one event. `coverJpeg` is a
 * downscaled JPEG to upload, or null to keep whatever the event already
 * has. Upload first; if the record write then fails, the new blob is
 * deleted again; on a successful update that replaced the cover, the OLD
 * blob is deleted — only now is it unreferenced.
 */
export function useSaveEvent(): (
  event: EventRecord | null,
  input: EventInput,
  coverJpeg: Blob | null,
) => Promise<void> {
  const uploadCover = useUploadCover();
  const removeBlob = useRemoveBlobBestEffort();
  const createEvent = useCreateRecord<EventRecord>("events");
  const updateEvent = useUpdateRecord<EventRecord>("events");

  return async (event, input, coverJpeg) => {
    const coverId = coverJpeg ? await uploadCover(coverJpeg, input.title || "event cover") : "";
    try {
      if (event) {
        await updateEvent.mutateAsync({
          id: event.id,
          patch: {
            title: input.title,
            starts_at_ms: input.startsAtMs,
            place: input.place,
            description: input.description,
            // Blob content is immutable, so "replace the cover" is a new
            // blob + this pointer swap. `tz` is deliberately not resent:
            // the event keeps the zone it was created in.
            ...(coverId ? { cover_blob_id: coverId } : {}),
          },
        });
      } else {
        await createEvent.mutateAsync({
          title: input.title,
          starts_at_ms: input.startsAtMs,
          tz: localZone(),
          place: input.place,
          description: input.description,
          cover_blob_id: coverId,
          canceled: false,
        });
      }
    } catch (e) {
      // The record never took the new cover, so nothing points at the blob
      // just uploaded — clean it up rather than leak the host's quota.
      await removeBlob(coverId);
      throw e;
    }
    if (event && coverId) await removeBlob(event.cover_blob_id);
  };
}

/** Cancel / un-cancel: one boolean flip, the record and its RSVPs kept. */
export function useSetCanceled(): (event: EventRecord, canceled: boolean) => Promise<void> {
  const updateEvent = useUpdateRecord<EventRecord>("events");
  return async (event, canceled) => {
    await updateEvent.mutateAsync({ id: event.id, patch: { canceled } });
  };
}

/**
 * The cascade, in this order: the event's RSVP rows → the event record →
 * its cover blob. `rsvps` is the host portal's own RSVP list; before the
 * deletes it is brought up to date with the server and walked to its last
 * page, so rows guests wrote since the portal loaded are purged too.
 */
export function useDeleteEvent(
  rsvps: ReturnType<typeof useRsvps>,
): (event: EventRecord) => Promise<void> {
  const queryClient = useQueryClient();
  const deleteRsvp = useDeleteRecord("rsvps");
  const deleteEvent = useDeleteRecord("events");
  const removeBlob = useRemoveBlobBestEffort();

  async function rsvpsOf(eventId: string): Promise<RsvpRecord[]> {
    await queryClient.invalidateQueries({ queryKey: serviceQueryKey("simple-db", "records", "rsvps") });
    let loaded = await rsvps.fetchNextPage();
    while (loaded.hasNextPage) loaded = await rsvps.fetchNextPage();
    return (loaded.data ?? []).filter((r) => r.event_id === eventId);
  }

  async function removeRecord(remove: (id: string) => Promise<unknown>, id: string): Promise<void> {
    try {
      await remove(id);
    } catch (e) {
      if (!isGone(e)) throw e;
    }
  }

  return async (event) => {
    for (const row of await rsvpsOf(event.id)) await removeRecord(deleteRsvp.mutateAsync, row.id);
    await removeRecord(deleteEvent.mutateAsync, event.id);
    await removeBlob(event.cover_blob_id);
  };
}
