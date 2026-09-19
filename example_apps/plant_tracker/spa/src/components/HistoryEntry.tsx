// One timeline row: drop bubble, when, optional note, optional thumb, and
// an ALWAYS-VISIBLE delete (the UX demo's hover-only delete is unreachable
// on touch — a deliberate deviation). Deleting cascades to the entry's
// photo blob (plant_store.removeWatering) and is confirmed by the parent:
// blob deletes are hard deletes, so unlike the one-tap water there is no
// undo to offer.

import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { WateringRecord } from "../lib/db";
import { fmtWhen } from "../lib/time";
import { tintOf } from "../stores/plant_store";
import { BlobImage } from "./BlobImage";

interface Props {
  watering: WateringRecord;
  onDelete: () => void;
}

export function HistoryEntry({ watering, onDelete }: Props) {
  const { t, i18n } = useTranslation();
  return (
    <div className="flex gap-3 border-t py-3" style={{ borderColor: "var(--hairline)" }}>
      <div
        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full"
        style={{ background: "var(--water-soft)", color: "var(--water)" }}
      >
        <Icon icon="ph:drop-fill" width={12} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold">
          {fmtWhen(watering._created_at_ms, i18n.language)}
        </div>
        {watering.note && (
          <div className="mt-0.5 text-[12.5px] leading-normal" style={{ color: "var(--muted)" }}>
            {watering.note}
          </div>
        )}
        {watering.photo_blob_id && (
          <BlobImage
            blobId={watering.photo_blob_id}
            tintIndex={tintOf(watering.id)}
            className="mt-2 h-[62px] w-[84px] rounded-[8px] border"
            alt={t("plant.history")}
          />
        )}
      </div>
      <button
        type="button"
        className="mini-btn mini-btn-danger self-start"
        aria-label={t("plant.entryDelete")}
        onClick={onDelete}
      >
        <Icon icon="ph:trash" width={13} />
      </button>
    </div>
  );
}
