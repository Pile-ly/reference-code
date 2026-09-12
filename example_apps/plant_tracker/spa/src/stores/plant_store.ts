// All tracker data, in one store the pages share — and the home of the
// CLIENT-SIDE CASCADES (locked design: records and blobs never cascade on
// their own; deleting a watering deletes its photo blob, deleting a plant
// deletes its waterings, their blobs, and the cover blob).
//
// Data flow: `loadAll()` pulls both tables in full (cursor-walked
// `records/list`) and every screen derives from those arrays: the home
// grid sorts plants by creation, a plant page filters its waterings,
// stats are pure functions. Mutations write through simple_db/simple_blob
// first and then patch the local arrays with the server's answer — the
// server-minted fields (`id`, `_created_at_ms`) only exist on the returned
// record, so local echo without the round trip is never correct.
//
// The delete invariant everywhere: RECORD FIRST, BLOB SECOND. A failure
// between the two orphans a blob — invisible, quota-only damage, findable
// with simple-blob's /list, harmless — but the reverse order could leave a
// live record pointing at a hard-deleted blob, which is a permanently
// broken screen. Both delete helpers tolerate 404s so retries converge.

import { create } from "zustand";
import { deleteBlob, uploadBlob } from "../lib/blob";
import {
  DbError,
  type PlantRecord,
  type PlantTable,
  SimpleDb,
  type WateringRecord,
} from "../lib/db";

/** Record delete where "already gone" (uniform 404) counts as success —
 *  the cascade must converge when retried after a partial failure. */
async function removeRecord(table: PlantTable, id: string): Promise<void> {
  try {
    await SimpleDb.remove(table, id);
  } catch (e) {
    if (!(e instanceof DbError && e.status === 404)) throw e;
  }
}

/** Blob delete AFTER its record is gone: a failure here is non-fatal by
 *  design (see the invariant above) — log the orphan and move on. */
async function removeBlobBestEffort(blobId: string): Promise<void> {
  if (!blobId) return;
  try {
    await deleteBlob(blobId);
  } catch (e) {
    console.warn("plant_tracker: orphaned blob (its record is already deleted)", blobId, e);
  }
}

interface PlantState {
  /** Creation order (the grid's order). Null = not loaded yet. */
  plants: PlantRecord[] | null;
  /** ALL waterings, newest first (one owner — modest scale by design). */
  waterings: WateringRecord[] | null;
  loading: boolean;
  loadError: string | null;
  /** The uniform 404 on load: a non-owner (or a broken deploy) — the app
   *  renders "nothing here", indistinguishable from a nonexistent app. */
  notFound: boolean;
  /** Double-tap guard: the plant whose one-tap water is in flight. */
  pendingWaterPlantId: string | null;

  loadAll: (force?: boolean) => Promise<void>;
  /** One-tap water: `{plant_id}` only (locked design). Returns the created
   *  record (the Undo closure needs its id), or null when debounced. */
  quickWater: (plantId: string) => Promise<WateringRecord | null>;
  /** The sheet's save: optional note, optional (already downscaled) photo. */
  logWatering: (plantId: string, note: string, photo: Blob | null) => Promise<WateringRecord>;
  /** Cascade (a): entry record, then its blob. Also IS the undo action. */
  removeWatering: (id: string) => Promise<void>;
  addPlant: (name: string, photo: Blob | null) => Promise<PlantRecord>;
  changePhoto: (plantId: string, photo: Blob) => Promise<void>;
  /** Cascade (b): re-list children server-side, delete each (record then
   *  blob), then the plant record, then the cover blob. */
  deletePlant: (plantId: string) => Promise<void>;
}

export const usePlantStore = create<PlantState>((set, get) => ({
  plants: null,
  waterings: null,
  loading: false,
  loadError: null,
  notFound: false,
  pendingWaterPlantId: null,

  loadAll: async (force = false) => {
    const { plants, loading } = get();
    if (loading || (plants !== null && !force)) return;
    set({ loading: true, loadError: null, notFound: false });
    try {
      // Two independent tables — fetch concurrently.
      const [plantRows, wateringRows] = await Promise.all([
        SimpleDb.listAll<PlantRecord>("plants"),
        SimpleDb.listAll<WateringRecord>("waterings"),
      ]);
      // Grid order is CREATION order (the UX spec appends new plants at the
      // end) — an explicit ascending sort, not a `.reverse()` of the
      // newest-first list order, so it stays obviously correct across pages.
      plantRows.sort((a, b) => a._created_at_ms - b._created_at_ms);
      wateringRows.sort((a, b) => b._created_at_ms - a._created_at_ms);
      set({ plants: plantRows, waterings: wateringRows, loading: false });
    } catch (e) {
      if (e instanceof DbError && e.status === 404) {
        set({ loading: false, notFound: true });
      } else {
        set({ loading: false, loadError: e instanceof Error ? e.message : String(e) });
      }
    }
  },

  quickWater: async (plantId) => {
    if (get().pendingWaterPlantId) return null;
    set({ pendingWaterPlantId: plantId });
    try {
      const record = await SimpleDb.create<WateringRecord>("waterings", {
        plant_id: plantId,
        note: "",
        photo_blob_id: "",
      });
      set((s) => ({ waterings: [record, ...(s.waterings ?? [])] }));
      return record;
    } finally {
      set({ pendingWaterPlantId: null });
    }
  },

  logWatering: async (plantId, note, photo) => {
    // Blob first, record second: a record must never point at a blob that
    // doesn't exist. The failure branch cleans up the fresh orphan.
    const blobId = photo ? await uploadBlob(photo, "watering photo") : "";
    let record: WateringRecord;
    try {
      record = await SimpleDb.create<WateringRecord>("waterings", {
        plant_id: plantId,
        note,
        photo_blob_id: blobId,
      });
    } catch (e) {
      await removeBlobBestEffort(blobId);
      throw e;
    }
    set((s) => ({ waterings: [record, ...(s.waterings ?? [])] }));
    return record;
  },

  removeWatering: async (id) => {
    const watering = get().waterings?.find((w) => w.id === id);
    await removeRecord("waterings", id);
    await removeBlobBestEffort(watering?.photo_blob_id ?? "");
    set((s) => ({ waterings: (s.waterings ?? []).filter((w) => w.id !== id) }));
  },

  addPlant: async (name, photo) => {
    const blobId = photo ? await uploadBlob(photo, `${name} cover`) : "";
    let record: PlantRecord;
    try {
      record = await SimpleDb.create<PlantRecord>("plants", {
        name,
        photo_blob_id: blobId,
      });
    } catch (e) {
      await removeBlobBestEffort(blobId);
      throw e;
    }
    // Creation order → the new plant appends at the end, like the demo.
    set((s) => ({ plants: [...(s.plants ?? []), record] }));
    return record;
  },

  changePhoto: async (plantId, photo) => {
    const plant = get().plants?.find((p) => p.id === plantId);
    const newBlobId = await uploadBlob(photo, `${plant?.name ?? "plant"} cover`);
    let record: PlantRecord;
    try {
      record = await SimpleDb.update<PlantRecord>("plants", plantId, {
        photo_blob_id: newBlobId,
      });
    } catch (e) {
      await removeBlobBestEffort(newBlobId);
      throw e;
    }
    // Only after the record points at the new blob may the old one go.
    await removeBlobBestEffort(plant?.photo_blob_id ?? "");
    set((s) => ({ plants: (s.plants ?? []).map((p) => (p.id === plantId ? record : p)) }));
  },

  deletePlant: async (plantId) => {
    const plant = get().plants?.find((p) => p.id === plantId);
    try {
      // Collect first, delete second — and collect from the SERVER with the
      // `eq` filter (another device may hold waterings this page never
      // loaded; also, deleting while cursoring is unstable).
      const children = await SimpleDb.listAll<WateringRecord>("waterings", {
        plant_id: plantId,
      });
      for (const w of children) {
        await removeRecord("waterings", w.id);
        await removeBlobBestEffort(w.photo_blob_id);
      }
      // Children gone → the plant record → its cover blob. The record stays
      // until every child is deleted, so a partial failure leaves the plant
      // visible and Delete tappable again; the retry re-lists and only
      // finds what's left.
      await removeRecord("plants", plantId);
      await removeBlobBestEffort(plant?.photo_blob_id ?? "");
    } catch (e) {
      // Resync so the UI shows exactly what survived, then let the page
      // toast "tap Delete to retry".
      await get()
        .loadAll(true)
        .catch(() => undefined);
      throw e;
    }
    set((s) => ({
      plants: (s.plants ?? []).filter((p) => p.id !== plantId),
      waterings: (s.waterings ?? []).filter((w) => w.plant_id !== plantId),
    }));
  },
}));

// ── Pure selectors (used with usePlantStore(...) or on a snapshot) ──

/** A plant's waterings, newest first. */
export function wateringsFor(
  waterings: WateringRecord[] | null,
  plantId: string,
): WateringRecord[] {
  return (waterings ?? []).filter((w) => w.plant_id === plantId);
}

/** `_created_at_ms` of the most recent watering, or null if never. */
export function lastWateredMs(
  waterings: WateringRecord[] | null,
  plantId: string,
): number | null {
  return wateringsFor(waterings, plantId)[0]?._created_at_ms ?? null;
}

/** Stable placeholder-tint index for a record without a photo — the demo
 *  stored one at creation; hashing the id gives the same stability free. */
export function tintOf(id: string): number {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum = (sum + id.charCodeAt(i)) % 4;
  return sum;
}
