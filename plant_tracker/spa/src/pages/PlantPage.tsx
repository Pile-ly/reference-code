// One plant: hero (cover photo, back, Change photo / Delete), the three
// stat tiles, the Water-now CTA that swaps INLINE for the sheet, and the
// history timeline. Reached by deep link too — /plant/<record id> resolves
// after loadAll(); an unknown id renders the missing panel.
//
// Destructive actions here both confirm (deviation from the demo, on
// purpose): entry delete and plant delete cascade to HARD blob deletes,
// so unlike the undoable one-tap water there is no taking them back.

import { Icon } from "@iconify/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { HistoryEntry } from "../components/HistoryEntry";
import { StatTiles } from "../components/StatTiles";
import { WaterSheet } from "../components/WaterSheet";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { pickPhotoBlob } from "../hooks/usePhotoPicker";
import type { WateringRecord } from "../lib/db";
import { avgGapDays } from "../lib/stats";
import { fmtSince } from "../lib/time";
import { tintOf, usePlantStore, wateringsFor } from "../stores/plant_store";
import { toast } from "../stores/toast_store";

interface Props {
  plantId: string;
}

export function PlantPage({ plantId }: Props) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const store = usePlantStore();
  const loadAll = usePlantStore((s) => s.loadAll);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const plant = store.plants?.find((p) => p.id === plantId) ?? null;
  // Hooks run unconditionally (blobId "" short-circuits) — guards below.
  const { url: heroUrl } = useBlobUrl(plant?.photo_blob_id ?? "");

  if (store.notFound) {
    return (
      <p className="px-5 py-24 text-center text-[14px]" style={{ color: "var(--faint)" }}>
        {t("common.nothingHere")}
      </p>
    );
  }
  if (store.plants === null) {
    return (
      <p className="px-5 py-16 text-center text-[14px]" style={{ color: "var(--faint)" }}>
        {store.loadError
          ? t("common.error", { reason: store.loadError })
          : t("common.loading")}
      </p>
    );
  }
  if (!plant) {
    return (
      <div className="px-5 py-24 text-center">
        <p className="text-[14px]" style={{ color: "var(--faint)" }}>
          {t("plant.missing")}
        </p>
        <Link to="/" className="mt-3 inline-block text-[13px] underline underline-offset-2">
          {t("plant.backHome")}
        </Link>
      </div>
    );
  }

  const ws = wateringsFor(store.waterings, plantId);

  const saveWatering = async (note: string, photo: Blob | null) => {
    let record: WateringRecord;
    try {
      record = await store.logWatering(plantId, note, photo);
    } catch (e) {
      toast(t("common.error", { reason: e instanceof Error ? e.message : String(e) }));
      throw e; // the sheet stays open with the note intact
    }
    setSheetOpen(false);
    toast(photo ? t("sheet.loggedWithPhoto") : t("sheet.logged"), async () => {
      try {
        await store.removeWatering(record.id);
      } catch {
        toast(t("toast.undoFailed"));
      }
    });
  };

  const changePhoto = () => {
    pickPhotoBlob(
      (blob) => {
        store
          .changePhoto(plantId, blob)
          .then(() => toast(t("plant.photoChanged")))
          .catch((e: unknown) =>
            toast(t("common.error", { reason: e instanceof Error ? e.message : String(e) })),
          );
      },
      () => toast(t("photo.unreadable")),
    );
  };

  const deletePlant = async () => {
    if (!window.confirm(t("plant.confirmDelete"))) return;
    try {
      await store.deletePlant(plantId);
      void navigate({ to: "/" });
      toast(t("plant.deleted"));
    } catch {
      toast(t("plant.deleteFailed"));
    }
  };

  const deleteEntry = async (w: WateringRecord) => {
    if (!window.confirm(t("plant.entryConfirm"))) return;
    try {
      await store.removeWatering(w.id);
      toast(t("plant.entryDeleted"));
    } catch (e) {
      toast(t("common.error", { reason: e instanceof Error ? e.message : String(e) }));
    }
  };

  return (
    <div className="mx-auto max-w-[640px]">
      <div
        className="relative h-[170px]"
        style={
          heroUrl
            ? {
                backgroundImage: `url(${heroUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
              }
            : { background: `var(--tint-${tintOf(plant.id)})` }
        }
      >
        <Link
          to="/"
          aria-label={t("plant.backHome")}
          className="absolute left-3 top-3 flex h-[30px] w-[30px] items-center justify-center rounded-full text-[15px]"
          style={{ background: "rgba(255,255,255,.85)", color: "#1c1f1a" }}
        >
          {"←"}
        </Link>
        <div className="absolute right-3 top-3 flex gap-1.5">
          <button type="button" className="hero-pill" onClick={changePhoto}>
            {t("plant.changePhoto")}
          </button>
          <button type="button" className="hero-pill" onClick={() => void deletePlant()}>
            {t("plant.delete")}
          </button>
        </div>
        <div className="absolute bottom-3 left-4">
          <div
            className="text-[20px] font-bold text-white"
            style={{ textShadow: "0 1px 4px rgba(0,0,0,.45)" }}
          >
            {plant.name}
          </div>
          <div
            className="text-[11.5px]"
            style={{ color: "rgba(255,255,255,.92)", textShadow: "0 1px 4px rgba(0,0,0,.45)" }}
          >
            {t("plant.since", {
              date: fmtSince(plant._created_at_ms, i18n.language),
              count: ws.length,
            })}
          </div>
        </div>
      </div>

      <div className="px-5 pb-10">
        <StatTiles
          lastWateredMs={ws[0]?._created_at_ms ?? null}
          count={ws.length}
          avgDays={avgGapDays(ws.map((w) => w._created_at_ms))}
        />

        {sheetOpen ? (
          <WaterSheet onCancel={() => setSheetOpen(false)} onSave={saveWatering} />
        ) : (
          <>
            <button type="button" className="waternow" onClick={() => setSheetOpen(true)}>
              <Icon icon="ph:drop-fill" width={16} />
              {t("plant.waterNow")}
            </button>
            <p className="mt-[7px] text-center text-[11.5px]" style={{ color: "var(--faint)" }}>
              {t("plant.waterHint")}
            </p>
          </>
        )}

        <div className="mt-5">
          <h3 className="mb-1 text-[13px] font-semibold" style={{ color: "var(--muted)" }}>
            {t("plant.history")}
          </h3>
          {ws.length === 0 ? (
            <p className="py-3.5 text-[13px]" style={{ color: "var(--faint)" }}>
              {t("plant.historyEmpty")}
            </p>
          ) : (
            ws.map((w) => (
              <HistoryEntry key={w.id} watering={w} onDelete={() => void deleteEntry(w)} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
