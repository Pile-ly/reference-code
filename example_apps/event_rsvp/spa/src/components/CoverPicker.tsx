// The cover slot in the host's event form: shows the picked photo, or the
// event's existing cover, or an empty dashed target.
//
// Nothing is uploaded here. The picker only decodes and DOWNSCALES the
// file (usePhotoPicker → lib/image.ts, ~1600 px JPEG); the upload happens
// when the host saves, so an abandoned form never burns blob quota — and
// a replaced cover only deletes the old blob once the record actually
// points at the new one (stores/event_store.ts).

import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useBlobUrl } from "../hooks/useBlobUrl";
import type { EventRecord } from "../lib/db";

interface Props {
  /** Object-URL preview of a freshly picked (already downscaled) photo. */
  previewUrl: string | null;
  /** The event being edited, for its current cover. Null when creating. */
  event: EventRecord | null;
  onPick: () => void;
}

export function CoverPicker({ previewUrl, event, onPick }: Props) {
  const { t } = useTranslation();
  // The existing cover needs a fresh presigned link like anywhere else —
  // the record only ever holds the blob id.
  const { url: existingUrl } = useBlobUrl(previewUrl ? "" : (event?.cover_blob_id ?? ""));
  const shown = previewUrl ?? existingUrl;

  return (
    <>
      <button
        type="button"
        className={`covpick ${shown ? "has-image" : ""}`}
        style={shown ? { backgroundImage: `url(${shown})` } : undefined}
        onClick={onPick}
      >
        {!shown && (
          <>
            <Icon icon="ph:image" width={18} />
            {t("form.coverAdd")}
          </>
        )}
      </button>
      {previewUrl && (
        <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--faint)" }}>
          {t("form.coverPending")}
        </p>
      )}
    </>
  );
}
