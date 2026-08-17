// One photo, resolved per render: blobId → useBlobUrl (a fresh short-lived
// download link) → <img>. While the link is loading — or when there is no
// photo at all, or the fetch was denied — the record's placeholder tint
// renders instead, so screens never flash broken images.
//
// Expired-link recovery: a presigned URL can outlive its validity on a
// long-open page; when the <img> errors we re-request the link ONCE, then
// stick with the tint (a second failure means something real is wrong).

import { useRef } from "react";
import { useBlobUrl } from "../hooks/useBlobUrl";

interface Props {
  /** "" = no photo — renders the tint immediately, no fetch. */
  blobId: string;
  /** 0–3, from tintOf(record.id). */
  tintIndex: number;
  /** Sizing/rounding classes from the caller; object-cover is added here. */
  className?: string;
  alt: string;
}

export function BlobImage({ blobId, tintIndex, className, alt }: Props) {
  const { url, retry } = useBlobUrl(blobId);
  const retried = useRef(false);

  if (!url) {
    return (
      <div
        className={className}
        style={{ background: `var(--tint-${tintIndex % 4})` }}
        role="img"
        aria-label={alt}
      />
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      className={`${className ?? ""} object-cover`}
      onError={() => {
        if (!retried.current) {
          retried.current = true;
          retry();
        }
      }}
    />
  );
}
