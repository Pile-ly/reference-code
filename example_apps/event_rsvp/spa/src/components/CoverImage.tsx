// One event cover, resolved per render: blobId → useBlobUrl (a fresh
// short-lived download link from @pilely/simple-blob) → <img>. While the
// link is loading — or when the event has no photo, or the fetch was
// denied — the generative CoverArt (seeded from the event id) renders
// instead, so screens never flash a broken image. Callers give the
// wrapping element `position: relative` and a size; this component fills
// it.
//
// This is the component a signed-OUT visitor exercises: the cover blob was
// uploaded with `anon_read: true`, so simple_blob mints a link for the
// anonymous credential too (hooks/useEventWrites.ts explains the pattern).
//
// Link lifetime: the hook replaces the presigned URL before it expires. An
// <img> that still fails to load shows the art until the hook hands over a
// different URL.

import { useBlobUrl } from "@pilely/simple-blob";
import { useState } from "react";
import { CoverArt } from "./CoverArt";

interface Props {
  /** "" = no cover photo — renders the art immediately, no fetch. */
  blobId: string;
  /** Seeds the generative fallback (the event id). */
  seed: string;
  alt: string;
}

export function CoverImage({ blobId, seed, alt }: Props) {
  const { data } = useBlobUrl(blobId || undefined);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url = data?.url ?? null;

  if (!url || url === failedUrl) return <CoverArt seed={seed} />;
  return <img src={url} alt={alt} className="cover-img" onError={() => setFailedUrl(url)} />;
}
