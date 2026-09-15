// One grid cell on the home page: cover photo (or a generated portrait when
// there's no photo), name, "watered X ago", and the ONE-TAP Water button
// (locked design: it logs `{plant_id}` instantly; the toast's Undo is a real
// records/delete — no confirm, because undo). Photo and name navigate; the
// button only waters.

import { Icon } from "@iconify/react";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { PlantRecord } from "../lib/db";
import { agoLabel } from "../lib/time";
import { tintOf } from "../stores/plant_store";
import { BlobImage } from "./BlobImage";
import { kindFor, PlantArt } from "./PlantArt";

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
    <div className="plant-card">
      <Link to="/plant/$plantId" params={{ plantId: plant.id }} className="block">
        <BlobImage
          blobId={plant.photo_blob_id}
          tintIndex={tintOf(plant.id)}
          className="aspect-[4/3] w-full"
          alt={plant.name}
          fallback={<PlantArt seed={plant.id} kind={kindFor(plant.name)} />}
        />
      </Link>
      <div className="px-3.5 pb-3.5 pt-3">
        <Link
          to="/plant/$plantId"
          params={{ plantId: plant.id }}
          className="block text-[14.5px] font-semibold"
        >
          {plant.name}
        </Link>
        <div className="mb-2.5 mt-1 text-[12px]" style={{ color: "var(--faint)" }}>
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
