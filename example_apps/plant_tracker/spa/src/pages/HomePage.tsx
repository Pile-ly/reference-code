// Home: the plant grid (2 columns, 4 on wider screens) with the one-tap
// Water on every card and the dashed add-card at the end. Empty state is
// the demo's two quiet lines — no grid, no add-card (the nav's "+ Plant"
// is the entry point).
//
// The one-tap flow (locked design): create `{plant_id}` instantly → toast
// "<name> watered" with a REAL Undo (records/delete via the store; the
// closure holds only the record id, so it works after navigating away).

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { AddCard } from "../components/AddCard";
import { PlantCard } from "../components/PlantCard";
import type { PlantRecord } from "../lib/db";
import { lastWateredMs, usePlantStore } from "../stores/plant_store";
import { toast } from "../stores/toast_store";

export function HomePage() {
  const { t } = useTranslation();
  const {
    plants,
    waterings,
    loading,
    loadError,
    notFound,
    pendingWaterPlantId,
    loadAll,
    quickWater,
    removeWatering,
  } = usePlantStore();

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const water = async (plant: PlantRecord) => {
    try {
      const record = await quickWater(plant.id);
      if (!record) return; // debounced double-tap
      toast(t("home.watered", { name: plant.name }), async () => {
        try {
          await removeWatering(record.id);
        } catch {
          toast(t("toast.undoFailed"));
        }
      });
    } catch (e) {
      toast(t("common.error", { reason: e instanceof Error ? e.message : String(e) }));
    }
  };

  // The uniform 404 on load = a non-owner (or a broken deploy). "Nothing
  // here" is the only honest render — indistinguishable from no app at all.
  if (notFound) {
    return (
      <p className="px-5 py-24 text-center text-[14px]" style={{ color: "var(--faint)" }}>
        {t("common.nothingHere")}
      </p>
    );
  }

  if (plants === null) {
    return (
      <p className="px-5 py-16 text-center text-[14px]" style={{ color: "var(--faint)" }}>
        {loading || !loadError ? t("common.loading") : t("common.error", { reason: loadError })}
      </p>
    );
  }

  if (plants.length === 0) {
    return (
      <p className="px-5 py-[70px] text-center text-[14px]" style={{ color: "var(--faint)" }}>
        {t("home.emptyLine1")}
        <br />
        {t("home.emptyLine2")}
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-[860px] p-5 sm:px-8 sm:py-6">
      <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
        {plants.map((plant) => (
          <PlantCard
            key={plant.id}
            plant={plant}
            lastWateredMs={lastWateredMs(waterings, plant.id)}
            pending={pendingWaterPlantId === plant.id}
            onWater={() => void water(plant)}
          />
        ))}
        <AddCard />
      </div>
    </div>
  );
}
