// The host's new/edit event form. In-page state inside /admin (a
// half-filled form is not a shareable URL), same as the UX demo.
//
// The one interesting field is the time. The demo had three free-text
// boxes (date / day / time) which cannot be sorted or split into
// upcoming-vs-past; this form has ONE datetime-local input, converted to
// the stored `starts_at_ms` through lib/time.ts. An event keeps the zone
// it was created in, so editing it from another zone still shows — and
// saves — the host's own wall-clock time; the hint under the field names
// that zone explicitly rather than leaving it implied.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LIMITS } from "../config";
import { usePhotoPicker } from "../hooks/usePhotoPicker";
import type { EventRecord } from "../lib/db";
import { localZone, wallTimeInZone, wallTimeToMs } from "../lib/time";
import type { EventInput } from "../stores/event_store";
import { toast } from "../stores/toast_store";
import { CoverPicker } from "./CoverPicker";

interface Props {
  /** The event being edited, or null for a new one. */
  event: EventRecord | null;
  onCancel: () => void;
  onSave: (input: EventInput, coverBlob: Blob | null) => Promise<void>;
}

export function EventForm({ event, onCancel, onSave }: Props) {
  const { t } = useTranslation();
  // An existing event is edited in ITS zone; a new one is created in the
  // host's current zone (which the store stamps onto the record).
  const zone = event?.tz || localZone();

  const [title, setTitle] = useState(event?.title ?? "");
  const [when, setWhen] = useState(event ? wallTimeInZone(event.starts_at_ms, zone) : "");
  const [place, setPlace] = useState(event?.place ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [saving, setSaving] = useState(false);

  const { picked, pick } = usePhotoPicker(() => toast(t("form.coverFailed")));

  async function save() {
    if (saving) return;
    const startsAtMs = wallTimeToMs(when, zone);
    if (!title.trim()) {
      toast(t("form.needTitle"));
      return;
    }
    if (Number.isNaN(startsAtMs)) {
      toast(t("form.needWhen"));
      return;
    }
    setSaving(true);
    try {
      await onSave(
        {
          title: title.trim(),
          startsAtMs,
          place: place.trim(),
          description: description.trim(),
        },
        picked?.blob ?? null,
      );
    } finally {
      // The page unmounts this form on success; on failure the host keeps
      // everything they typed and can hit save again.
      setSaving(false);
    }
  }

  return (
    <div className="col">
      <h2 className="pt-5 pb-1 text-[20px] font-bold">
        {event ? t("form.editTitle") : t("form.newTitle")}
      </h2>

      <label className="field-label">{t("form.cover")}</label>
      <CoverPicker previewUrl={picked?.previewUrl ?? null} event={event} onPick={pick} />

      <label className="field-label" htmlFor="ev-title">
        {t("form.title")}
      </label>
      <input
        id="ev-title"
        className="field"
        value={title}
        maxLength={LIMITS.titleMax}
        placeholder={t("form.titlePlaceholder")}
        onChange={(e) => setTitle(e.target.value)}
      />

      <label className="field-label" htmlFor="ev-when">
        {t("form.when")}
      </label>
      <input
        id="ev-when"
        className="field"
        type="datetime-local"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
      />
      <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--faint)" }}>
        {t("form.whenHint", { zone })}
      </p>

      <label className="field-label" htmlFor="ev-place">
        {t("form.place")}
      </label>
      <input
        id="ev-place"
        className="field"
        value={place}
        maxLength={LIMITS.placeMax}
        placeholder={t("form.placePlaceholder")}
        onChange={(e) => setPlace(e.target.value)}
      />

      <label className="field-label" htmlFor="ev-desc">
        {t("form.description")}
      </label>
      <textarea
        id="ev-desc"
        className="field"
        value={description}
        maxLength={LIMITS.descriptionMax}
        placeholder={t("form.descriptionPlaceholder")}
        onChange={(e) => setDescription(e.target.value)}
      />
      <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--faint)" }}>
        {/* simple_db caps a record at ~16 KB of serialized fields — surfaced
            here rather than discovered as a failed save. */}
        {t("form.remaining", { count: LIMITS.descriptionMax - description.length })}
      </p>

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn btn-ghost" disabled={saving} onClick={onCancel}>
          {t("form.cancel")}
        </button>
        <button
          type="button"
          className="btn btn-accent"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? t("form.saving") : event ? t("form.save") : t("form.publish")}
        </button>
      </div>
    </div>
  );
}
