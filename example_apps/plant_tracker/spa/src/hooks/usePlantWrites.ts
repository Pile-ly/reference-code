// The tracker's writes — and the home of the CLIENT-SIDE CASCADES (records
// and blobs never cascade on their own: deleting a watering deletes its
// photo blob; deleting a plant deletes its waterings, their blobs, and the
// cover blob).
//
// Every step is a `mutateAsync` from the @pilely hooks, awaited in order, so
// each write refreshes the reads it affects on its own — no hand patching.
// Record writes are optimistic: a new plant or watering shows at once, a
// deleted one leaves at once, and a refused write rolls back.
//
// Photos use the PRIVATE shape: every upload names `read_group` = the
// memberless group the tables use (config.ts) and no `anon_read`. On a
// private app that group is the real boundary at the storage hosts, which
// the app-host 404 does not cover.
//
// The delete invariant everywhere: RECORD FIRST, BLOB SECOND. A failure
// between the two orphans a blob — invisible, quota-only damage, findable
// with simple-blob's /list — while the reverse order could leave a live
// record pointing at a hard-deleted blob, which is a permanently broken
// screen. Record deletes tolerate the uniform 404 and `useDeleteBlob`
// counts an already-gone blob as deleted, so a retry converges.

import { serviceQueryKey } from "@pilely/core";
import { useDeleteBlob, useUpload } from "@pilely/simple-blob";
import { useCreateRecord, useDeleteRecord, useUpdateRecord } from "@pilely/simple-db";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { READ_GROUP } from "../config";
import type { PlantRecord, WateringRecord } from "../lib/records";
import { isGone, type useWaterings } from "./usePlantRecords";

/** Upload one downscaled JPEG as a private photo; resolves with the
 *  `blob_nanoid` the record stores. */
function useUploadPhoto(): (jpeg: Blob, displayName: string) => Promise<string> {
  const upload = useUpload();
  return async (jpeg, displayName) => {
    const blob = await upload.mutateAsync({
      // A named file part, so the stored upload carries a real file name.
      file: new File([jpeg], "photo.jpg", { type: "image/jpeg" }),
      extension: "jpg",
      content_type: "image/jpeg",
      read_group: READ_GROUP,
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
      console.warn("plant_tracker: orphaned blob (its record is already deleted)", blobId, e);
    }
  };
}

/** Record delete where "already gone" (the uniform 404) counts as success —
 *  the cascade must converge when retried after a partial failure. */
async function removeRecord(remove: (id: string) => Promise<unknown>, id: string): Promise<void> {
  try {
    await remove(id);
  } catch (e) {
    if (!isGone(e)) throw e;
  }
}

/**
 * The card's one-tap water: `{plant_id}` only, no note, no photo. Resolves
 * with the created record (an Undo needs its id), or null when another
 * one-tap is still in flight — the double-tap guard. `pendingPlantId` is
 * the plant whose water is in flight, for disabling its button.
 */
export function useQuickWater(): {
  pendingPlantId: string | null;
  quickWater: (plantId: string) => Promise<WateringRecord | null>;
} {
  const createWatering = useCreateRecord<WateringRecord>("waterings");
  // The ref answers synchronously (a second tap in the same frame); the
  // state re-renders the disabled button.
  const inFlight = useRef(false);
  const [pendingPlantId, setPendingPlantId] = useState<string | null>(null);

  const quickWater = async (plantId: string) => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setPendingPlantId(plantId);
    try {
      return await createWatering.mutateAsync({ plant_id: plantId, note: "", photo_blob_id: "" });
    } finally {
      inFlight.current = false;
      setPendingPlantId(null);
    }
  };
  return { pendingPlantId, quickWater };
}

/** The sheet's save: optional note, optional (already downscaled) photo.
 *  Upload first, record second; if the record fails, the fresh blob is
 *  deleted again. */
export function useLogWatering(): (
  plantId: string,
  note: string,
  photo: Blob | null,
) => Promise<WateringRecord> {
  const uploadPhoto = useUploadPhoto();
  const removeBlob = useRemoveBlobBestEffort();
  const createWatering = useCreateRecord<WateringRecord>("waterings");
  return async (plantId, note, photo) => {
    const blobId = photo ? await uploadPhoto(photo, "watering photo") : "";
    try {
      return await createWatering.mutateAsync({ plant_id: plantId, note, photo_blob_id: blobId });
    } catch (e) {
      await removeBlob(blobId);
      throw e;
    }
  };
}

/** Cascade (a): the entry record, then its photo blob. Also the one-tap
 *  water's Undo — a mutation runs to the end even if the page that started
 *  it has unmounted, so the toast's Undo still works after navigating. */
export function useRemoveWatering(): (watering: WateringRecord) => Promise<void> {
  const deleteWatering = useDeleteRecord("waterings");
  const removeBlob = useRemoveBlobBestEffort();
  return async (watering) => {
    await removeRecord(deleteWatering.mutateAsync, watering.id);
    await removeBlob(watering.photo_blob_id);
  };
}

/** A new plant: photo (optional) first, then the record; a failed record
 *  deletes the fresh blob again. */
export function useAddPlant(): (name: string, photo: Blob | null) => Promise<PlantRecord> {
  const uploadPhoto = useUploadPhoto();
  const removeBlob = useRemoveBlobBestEffort();
  const createPlant = useCreateRecord<PlantRecord>("plants");
  return async (name, photo) => {
    const blobId = photo ? await uploadPhoto(photo, `${name} cover`) : "";
    try {
      return await createPlant.mutateAsync({ name, photo_blob_id: blobId });
    } catch (e) {
      await removeBlob(blobId);
      throw e;
    }
  };
}

/** Replace a plant's cover. Blob content is immutable, so this is upload
 *  the new one → point the record at it → delete the OLD one, which only
 *  now is unreferenced. A failed update deletes the new blob instead. */
export function useChangePhoto(): (plant: PlantRecord, photo: Blob) => Promise<void> {
  const uploadPhoto = useUploadPhoto();
  const removeBlob = useRemoveBlobBestEffort();
  const updatePlant = useUpdateRecord<PlantRecord>("plants");
  return async (plant, photo) => {
    const newBlobId = await uploadPhoto(photo, `${plant.name} cover`);
    try {
      await updatePlant.mutateAsync({ id: plant.id, patch: { photo_blob_id: newBlobId } });
    } catch (e) {
      await removeBlob(newBlobId);
      throw e;
    }
    await removeBlob(plant.photo_blob_id);
  };
}

/**
 * Cascade (b), in this order: each watering record then its photo → the
 * plant record → its cover blob. `waterings` is the plant page's own
 * history list; before the deletes it is brought up to date with the
 * server and walked to its last page, so waterings logged from another
 * device are purged too. The plant record stays until every child is
 * gone, so a partial failure leaves the plant visible and Delete tappable
 * again; the retry re-lists and only finds what is left.
 */
export function useDeletePlant(
  waterings: ReturnType<typeof useWaterings>,
): (plant: PlantRecord) => Promise<void> {
  const queryClient = useQueryClient();
  const deleteWatering = useDeleteRecord("waterings");
  const deletePlant = useDeleteRecord("plants");
  const removeBlob = useRemoveBlobBestEffort();

  async function wateringsOf(plantId: string): Promise<WateringRecord[]> {
    await queryClient.invalidateQueries({ queryKey: serviceQueryKey("simple-db", "records", "waterings") });
    let loaded = await waterings.fetchNextPage();
    while (loaded.hasNextPage) loaded = await waterings.fetchNextPage();
    return (loaded.data ?? []).filter((w) => w.plant_id === plantId);
  }

  return async (plant) => {
    for (const w of await wateringsOf(plant.id)) {
      await removeRecord(deleteWatering.mutateAsync, w.id);
      await removeBlob(w.photo_blob_id);
    }
    await removeRecord(deletePlant.mutateAsync, plant.id);
    await removeBlob(plant.photo_blob_id);
  };
}
