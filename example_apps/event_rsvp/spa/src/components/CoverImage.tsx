// One event cover, resolved per render: blobId → useBlobUrl (a fresh
// short-lived download link) → <img>. While the link is loading — or when
// the event has no photo, or the fetch was denied — the generative CoverArt
// (seeded from the event id) renders instead, so screens never flash a
// broken image. Callers give the wrapping element `position: relative` and a
// size; this component fills it.
//
// This is the component a signed-OUT visitor exercises: the cover blob was
// uploaded with `anon_read: true`, so simple_blob mints a link for the
// anonymous credential too (lib/blob.ts explains the pattern).
//
// Expired-link recovery: a presigned URL can outlive its validity on a
// long-open page; when the <img> errors we re-request the link ONCE, then
// fall back to the art (a second failure means something real is wrong).

import { useRef } from "react";
import { useBlobUrl } from "../hooks/useBlobUrl";
import { CoverArt } from "./CoverArt";

interface Props {
  /** "" = no cover photo — renders the art immediately, no fetch. */
  blobId: string;
  /** Seeds the generative fallback (the event id). */
  seed: string;
  alt: string;
}

export function CoverImage({ blobId, seed, alt }: Props) {
  const { url, retry } = useBlobUrl(blobId);
  const retried = useRef(false);

  if (!url) return <CoverArt seed={seed} />;
  return (
    <img
      src={url}
      alt={alt}
      className="cover-img"
      onError={() => {
        if (!retried.current) {
          retried.current = true;
          retry();
        }
      }}
    />
  );
}
