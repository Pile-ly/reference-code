// One event cover, resolved per render: blobId → useBlobUrl (a fresh
// short-lived download link) → <img>. While the link is loading — or when
// the event has no photo, or the fetch was denied — the event's gradient
// tint renders instead, so screens never flash a broken image.
//
// This is the component a signed-OUT visitor exercises: the cover blob was
// uploaded with `anon_read: true`, so simple_blob mints a link for the
// anonymous credential too (lib/blob.ts explains the pattern). Nothing
// here is aware of that — it is the same code path for everyone, which is
// the point.
//
// Expired-link recovery: a presigned URL can outlive its validity on a
// long-open page; when the <img> errors we re-request the link ONCE, then
// stick with the tint (a second failure means something real is wrong).

import { useRef } from "react";
import { useBlobUrl } from "../hooks/useBlobUrl";

interface Props {
  /** "" = no cover photo — renders the tint immediately, no fetch. */
  blobId: string;
  /** 0–3, from tintOf(event.id). */
  tintIndex: number;
  /** Sizing/positioning classes from the caller; object-cover is added. */
  className?: string;
  alt: string;
}

export function CoverImage({ blobId, tintIndex, className, alt }: Props) {
  const { url, retry } = useBlobUrl(blobId);
  const retried = useRef(false);

  if (!url) {
    return (
      <div
        className={`cover ${className ?? ""}`}
        style={{ background: `var(--cover-${tintIndex % 4})` }}
        role="img"
        aria-label={alt}
      />
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      className={`cover object-cover ${className ?? ""}`}
      onError={() => {
        if (!retried.current) {
          retried.current = true;
          retry();
        }
      }}
    />
  );
}
