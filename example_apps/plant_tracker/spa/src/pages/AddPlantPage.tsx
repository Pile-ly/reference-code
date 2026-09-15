// Add a plant: photo picker (camera capture on phones, downscaled before
// it ever leaves the device) + name. Photo is optional — the grid tint
// stands in. An empty name quietly becomes "Unnamed plant" (demo behavior,
// through i18n).

import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { kindFor, PlantArt } from "../components/PlantArt";
import { usePhotoPicker } from "../hooks/usePhotoPicker";
import { usePlantStore } from "../stores/plant_store";
import { toast } from "../stores/toast_store";

export function AddPlantPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const addPlant = usePlantStore((s) => s.addPlant);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const { picked, pick } = usePhotoPicker(() => toast(t("photo.unreadable")));

  const save = async () => {
    setBusy(true);
    const finalName = name.trim() || t("add.unnamed");
    try {
      await addPlant(finalName, picked?.blob ?? null);
    } catch (e) {
      toast(t("common.error", { reason: e instanceof Error ? e.message : String(e) }));
      setBusy(false);
      return;
    }
    void navigate({ to: "/" });
    toast(t("add.added", { name: finalName }));
  };

  return (
    <div className="mx-auto max-w-[420px] p-5">
      <h2 className="mb-4 text-[18px] font-bold">{t("add.heading")}</h2>

      <div className="mb-4 flex items-center gap-3.5">
        <div className="art-frame h-[76px] w-[76px] flex-none rounded-[14px]">
          <PlantArt seed={"new-" + name} kind={kindFor(name || "plant")} />
        </div>
        <p className="text-[12.5px]" style={{ color: "var(--muted)" }}>
          {t("add.portraitNote")}
        </p>
      </div>

      <button
        type="button"
        className="dashed-pick flex h-[130px] w-full flex-col items-center justify-center gap-1.5 rounded-[12px]"
        style={
          picked
            ? {
                backgroundImage: `url(${picked.previewUrl})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                borderStyle: "solid",
                color: "transparent",
              }
            : undefined
        }
        onClick={pick}
      >
        <span className="text-[22px] leading-none">{"📷"}</span>
        <span className="text-[12.5px]">{t("add.photo")}</span>
      </button>

      <label
        className="mb-1.5 mt-3.5 block text-[12px]"
        style={{ color: "var(--muted)" }}
        htmlFor="plant-name"
      >
        {t("add.nameLabel")}
      </label>
      <input
        id="plant-name"
        className="field px-3 py-2.5 text-[14px]"
        placeholder={t("add.namePlaceholder")}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />

      <div className="mt-5 flex justify-end gap-2.5">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void navigate({ to: "/" })}
          disabled={busy}
        >
          {t("add.cancel")}
        </button>
        <button type="button" className="btn btn-accent" onClick={() => void save()} disabled={busy}>
          {t("add.submit")}
        </button>
      </div>
    </div>
  );
}
