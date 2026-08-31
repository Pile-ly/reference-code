// blobId → a fresh short-lived download URL, fetched PER RENDERED CONSUMER
// (simple_blob contract: the presigned link is render-time only — the
// record keeps the id, the URL is derived from it every time and never
// cached or persisted).
//
// Flow: mount / blobId change → POST blobs/<id>/download → url state →
// <img src>. `retry()` bumps a nonce to re-run the fetch; BlobImage calls
// it once when an <img> errors (an expired link on a long-open page), then
// gives up to the placeholder tint.

import { useCallback, useEffect, useState } from "react";
import { downloadUrl } from "../lib/blob";

export function useBlobUrl(blobId: string): { url: string | null; retry: () => void } {
  const [url, setUrl] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!blobId) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    setUrl(null);
    downloadUrl(blobId)
      .then((u) => {
        if (!cancelled) setUrl(u);
      })
      .catch(() => {
        // Denied/missing/offline — url stays null and the consumer shows
        // its placeholder tint. Never inferred as "signed out".
      });
    return () => {
      cancelled = true;
    };
  }, [blobId, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { url, retry };
}
