// Home: the plant grid (2 columns, 4 on wider screens) with the one-tap
// Water on every card and the dashed add-card at the end. Empty state is
// the demo's two quiet lines — no grid, no add-card (the nav's "+ Plant"
// is the entry point).
//
// The one-tap flow (locked design): create `{plant_id}` instantly → toast
// "<name> watered" with a REAL Undo (a records/delete; the closure holds
// only the created record, so it works after navigating away).

import { useTranslation } from "react-i18next";
import { AddCard } from "../components/AddCard";
import { PlantCard } from "../components/PlantCard";
import { isGone, usePlants } from "../hooks/usePlantRecords";
import { useQuickWater, useRemoveWatering } from "../hooks/usePlantWrites";
import { byCreation, type PlantRecord } from "../lib/records";
import { toast } from "../stores/toast_store";

export function HomePage() {
  const { t } = useTranslation();
  const { data, error, isPending, hasNextPage, fetchNextPage, isFetchingNextPage } = usePlants();
  const { pendingPlantId, quickWater } = useQuickWater();
  const removeWatering = useRemoveWatering();

  const water = async (plant: PlantRecord) => {
    try {
      const record = await quickWater(plant.id);
      if (!record) return; // debounced double-tap
      toast(t("home.watered", { name: plant.name }), async () => {
        try {
          await removeWatering(record);
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
  if (isGone(error)) {
    return (
      <p className="px-5 py-24 text-center text-[14px]" style={{ color: "var(--faint)" }}>
        {t("common.nothingHere")}
      </p>
    );
  }

  if (!data) {
    return (
      <p className="px-5 py-16 text-center text-[14px]" style={{ color: "var(--faint)" }}>
        {isPending || !error ? t("common.loading") : t("common.error", { reason: error.message })}
      </p>
    );
  }

  if (data.length === 0) {
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
        {byCreation(data).map((plant) => (
          <PlantCard
            key={plant.id}
            plant={plant}
            pending={pendingPlantId === plant.id}
            onWater={() => void water(plant)}
          />
        ))}
        <AddCard />
      </div>
      {/* Pages arrive newest-created first, so older plants are the ones a
          next page adds — at the front of the creation-ordered grid. */}
      {hasNextPage && (
        <div className="mt-5 text-center">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {t("common.more")}
          </button>
        </div>
      )}
    </div>
  );
}
