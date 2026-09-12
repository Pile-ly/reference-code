// The Water-now sheet — an INLINE card that replaces the CTA in the page
// flow (UX spec: not a modal, no overlay, no slide-up). Note and photo are
// both optional; this is the ONLY place a watering can carry them (locked
// design — the card's one-tap never asks).
//
// Save flow: the parent's onSave uploads the blob + creates the record and
// closes the sheet on success; on failure it toasts and re-throws, and the
// sheet stays open with the note intact so the user just retries.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePhotoPicker } from "../hooks/usePhotoPicker";
import { toast } from "../stores/toast_store";

interface Props {
  onCancel: () => void;
  onSave: (note: string, photo: Blob | null) => Promise<void>;
}

export function WaterSheet({ onCancel, onSave }: Props) {
  const { t } = useTranslation();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const { picked, pick } = usePhotoPicker(() => toast(t("photo.unreadable")));

  const save = async () => {
    setBusy(true);
    try {
      await onSave(note.trim(), picked?.blob ?? null);
    } catch {
      // Parent already toasted; staying open IS the retry affordance.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2.5 rounded-[12px] border p-3.5" style={{ borderColor: "var(--hairline)" }}>
      <textarea
        className="field field-water min-h-[44px] resize-y px-[11px] py-[9px] text-[13px]"
        placeholder={t("sheet.notePlaceholder")}
        // Comfortable headroom under the ~16 KB record cap.
        maxLength={2000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          className="rounded-[8px] border px-3 py-[6px] text-[12px]"
          style={
            picked
              ? { borderStyle: "solid", borderColor: "var(--accent)", color: "var(--accent)" }
              : { borderStyle: "dashed", borderColor: "var(--hairline)", color: "var(--muted)" }
          }
          onClick={pick}
        >
          {picked ? t("sheet.attached") : t("sheet.attach")}
        </button>
        <div className="flex-1" />
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          {t("sheet.cancel")}
        </button>
        <button type="button" className="btn btn-water" onClick={() => void save()} disabled={busy}>
          {t("sheet.log")}
        </button>
      </div>
    </div>
  );
}
