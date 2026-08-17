// One grid cell on the home page: cover photo, name, "watered X ago", and
// the ONE-TAP Water button (locked design: it logs `{plant_id}` instantly;
// the toast's Undo is a real records/delete — no confirm, because undo).
// Photo and name navigate; the button only waters.

import { Icon } from "@iconify/react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { PlantRecord } from "../lib/db";
import { agoLabel } from "../lib/time";
import { tintOf } from "../stores/plant_store";
import { BlobImage } from "./BlobImage";

interface Props {
  plant: PlantRecord;
  lastWateredMs: number | null;
  /** True while this card's create is in flight (double-tap guard). */
  pending: boolean;
  onWater: () => void;
}

export function PlantCard({ plant, lastWateredMs, pending, onWater }: Props) {
  const { t } = useTranslation();
  return (
    <div
      className="overflow-hidden rounded-[14px] border"
      style={{ borderColor: "var(--hairline)", background: "var(--paper)" }}
    >
      <Link to="/plant/$plantId" params={{ plantId: plant.id }} className="block">
        <BlobImage
          blobId={plant.photo_blob_id}
          tintIndex={tintOf(plant.id)}
          className="h-[110px] w-full"
          alt={plant.name}
        />
      </Link>
      <div className="px-3 pb-3 pt-2.5">
        <Link
          to="/plant/$plantId"
          params={{ plantId: plant.id }}
          className="block text-[14px] font-semibold"
        >
          {plant.name}
        </Link>
        <div className="mb-2 mt-[3px] text-[11.5px]" style={{ color: "var(--faint)" }}>
          {lastWateredMs === null
            ? t("home.neverWatered")
            : t("home.wateredAgo", { ago: agoLabel((k, o) => String(t(k, o)), lastWateredMs) })}
        </div>
        <button type="button" className="waterbtn" disabled={pending} onClick={onWater}>
          <Icon icon="ph:drop-fill" width={14} />
          {t("home.water")}
        </button>
      </div>
    </div>
  );
}
