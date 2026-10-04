// One photo, resolved per render: blobId → useBlobUrl (a fresh short-lived
// download link from @pilely/simple-blob) → <img>. While the link is
// loading — or when there is no photo at all, or the fetch was denied — a
// fallback renders instead, so screens never flash broken images. Plant
// covers pass the generative <PlantArt> as that fallback; anything else
// falls back to the placeholder tint.
//
// Link lifetime: the hook replaces the presigned URL before it expires. An
// <img> that still fails to load shows the fallback until the hook hands
// over a different URL.

import { useBlobUrl } from "@pilely/simple-blob";
import { type ReactNode, useState } from "react";

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
  const { data } = useBlobUrl(blobId || undefined);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = data?.url ?? null;

  if (!url || url === failedUrl) {
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
      onError={() => setFailedUrl(url)}
    />
  );
}
