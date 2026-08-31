// One plant: a botanical hero (cover photo, or the generated portrait when
// there's no photo), the three stat tiles, the Water-now CTA that swaps
// INLINE for the sheet, a Download button for the portrait, and the history
// timeline. Reached by deep link too — /plant/<record id> resolves after
// loadAll(); an unknown id renders the missing panel.
//
// Destructive actions here both confirm (deviation from the demo, on
// purpose): entry delete and plant delete cascade to HARD blob deletes, so
// unlike the undoable one-tap water there is no taking them back.

import { Icon } from "@iconify/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { BlobImage } from "../components/BlobImage";
import { HistoryEntry } from "../components/HistoryEntry";
import { kindFor, PlantArt } from "../components/PlantArt";
import { StatTiles } from "../components/StatTiles";
import { WaterSheet } from "../components/WaterSheet";
import { pickPhotoBlob } from "../hooks/usePhotoPicker";
import type { WateringRecord } from "../lib/db";
import { avgGapDays } from "../lib/stats";
import { fmtSince } from "../lib/time";
import { tintOf, usePlantStore, wateringsFor } from "../stores/plant_store";
import { toast } from "../stores/toast_store";

interface Props {
  plantId: string;
}

/** Render the plant's generated portrait (the #hero-art SVG) to a labelled
 *  PNG and hand it to the browser to save. */
function downloadPortrait(name: string): void {
  const svg = document.getElementById("hero-art");
  if (!svg) return;
  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute("width", "240");
  clone.setAttribute("height", "240");
  const NS = "http://www.w3.org/2000/svg";
  const bg = document.createElementNS(NS, "rect");
  bg.setAttribute("width", "240"); bg.setAttribute("height", "240"); bg.setAttribute("fill", "#eef3e8");
  clone.insertBefore(bg, clone.firstChild);
  const str = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.onload = () => {
    const S = 960;
    const c = document.createElement("canvas");
    c.width = S; c.height = S + 120;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#eef3e8"; ctx.fillRect(0, 0, S, S + 120);
    ctx.drawImage(img, 0, 0, S, S);
    ctx.textAlign = "center"; ctx.fillStyle = "#1c2a1e";
    ctx.font = "600 56px -apple-system, system-ui, sans-serif";
    ctx.fillText(name, S / 2, S + 70);
    const a = document.createElement("a");
    a.download = `${name.replace(/\s+/g, "-").toLowerCase()}.png`;
    a.href = c.toDataURL("image/png");
    a.click();
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(str);
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
        {store.loadError ? t("common.error", { reason: store.loadError }) : t("common.loading")}
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

  const kind = kindFor(plant.name);
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
    <div className="mx-auto max-w-[640px] px-5 pb-12 pt-4">
      <div className="plant-hero">
        {plant.photo_blob_id ? (
          <BlobImage
            blobId={plant.photo_blob_id}
            tintIndex={tintOf(plant.id)}
            className="absolute inset-0 h-full w-full"
            alt={plant.name}
            fallback={<PlantArt seed={plant.id} kind={kind} />}
          />
        ) : (
          <PlantArt seed={plant.id} kind={kind} domId="hero-art" />
        )}
        <Link
          to="/"
          aria-label={t("plant.backHome")}
          className="hero-pill absolute left-3 top-3"
          style={{ padding: "6px 10px" }}
        >
          <Icon icon="ph:arrow-left" width={15} />
        </Link>
        <div className="absolute right-3 top-3 flex gap-1.5">
          <button type="button" className="hero-pill" onClick={changePhoto}>
            {t("plant.changePhoto")}
          </button>
          <button type="button" className="hero-pill" onClick={() => void deletePlant()}>
            {t("plant.delete")}
          </button>
        </div>
      </div>

      {/* When a photo is the hero, keep the portrait in the DOM so Download
          still has an #hero-art to serialize. */}
      {plant.photo_blob_id && (
        <div className="pointer-events-none absolute h-0 w-0 overflow-hidden" aria-hidden="true">
          <PlantArt seed={plant.id} kind={kind} domId="hero-art" />
        </div>
      )}

      <div className="plant-title mt-4 flex items-end justify-between gap-3">
        <div>
          <h1>{plant.name}</h1>
          <p>{t("plant.since", { date: fmtSince(plant._created_at_ms, i18n.language), count: ws.length })}</p>
        </div>
        <button type="button" className="mini-btn" onClick={() => downloadPortrait(plant.name)}>
          <Icon icon="ph:download-simple" width={13} />
          {t("plant.download")}
        </button>
      </div>

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
          <p className="mt-2 text-center text-[11.5px]" style={{ color: "var(--faint)" }}>
            {t("plant.waterHint")}
          </p>
        </>
      )}

      <div className="mt-6">
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
  );
}
