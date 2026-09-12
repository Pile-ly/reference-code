// One photo, resolved per render: blobId → useBlobUrl (a fresh short-lived
// download link) → <img>. While the link is loading — or when there is no
// photo at all, or the fetch was denied — a fallback renders instead, so
// screens never flash broken images. Plant covers pass the generative
// <PlantArt> as that fallback; anything else falls back to the placeholder
// tint.
//
// Expired-link recovery: a presigned URL can outlive its validity on a
// long-open page; when the <img> errors we re-request the link ONCE, then
// stick with the fallback (a second failure means something real is wrong).

import { type ReactNode, useRef } from "react";
import { useBlobUrl } from "../hooks/useBlobUrl";

interface Props {
  /** "" = no photo — renders the fallback immediately, no fetch. */
  blobId: string;
  /** 0–3, from tintOf(record.id) — the tint used when no `fallback` is given. */
  tintIndex: number;
  /** Sizing/rounding classes from the caller; object-cover is added here. */
  className?: string;
  alt: string;
  /** Custom no-photo fallback (e.g. a generated PlantArt). Fills the box. */
  fallback?: ReactNode;
}

export function BlobImage({ blobId, tintIndex, className, alt, fallback }: Props) {
  const { url, retry } = useBlobUrl(blobId);
  const retried = useRef(false);

  if (!url) {
    if (fallback !== undefined) {
      return (
        <div className={`art-frame ${className ?? ""}`} role="img" aria-label={alt}>
          {fallback}
        </div>
      );
    }
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
