// Photo storage: a thin client over simple_blob
// (manual: https://pilely.app/skill/app_management/simple_blob) — the file
// this app exists to demonstrate.
//
// Flow: photo picker → lib/image.ts downscale → uploadBlob (multipart,
// through window.pilely.fetch so the request carries THIS APP's token) →
// the record stores the returned `blob_nanoid` → every render calls
// downloadUrl(id) for a short-lived presigned link → deletes cascade from
// plant_store.ts (records and blobs never cascade on their own).
//
// The two rules that make or break a simple_blob app:
//
//  1. UPLOAD UNDER THE APP'S OWN TOKEN. A token minted for simple-blob
//     itself names no calling app; the upload "succeeds" but the blob binds
//     to NOTHING and your app can never serve it — permanently. Going
//     through `window.pilely.fetch` on the app's origin does the right
//     thing; the `app_id` check below turns the mistake into a loud error
//     for anyone who copies this code into a different auth setup.
//  2. THE DOWNLOAD URL IS RENDER-TIME ONLY. It is a short-lived presigned
//     link — never store it in a record or anywhere else; keep the
//     `blob_nanoid` and re-request the URL each time (hooks/useBlobUrl.ts).

import { READ_GROUP } from "../config";

/** A failed simple_blob call. 404 is the uniform denial (or truly missing —
 *  indistinguishable by design). */
export class BlobError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    reason: string,
  ) {
    super(reason);
    this.name = "BlobError";
  }
}

/** Same derivation as simple-db's in lib/db.ts — the reserved `simple-*`
 *  hosts are the standard's one hardcode exception; deriving from the apex
 *  keeps the bundle portable. */
function simpleBlobOrigin(): string {
  const apex = window.pilely?.apexOrigin() ?? "https://pilely.app";
  return apex.replace("://", "://simple-blob.");
}

async function pilelyFetch(path: string, init: RequestInit): Promise<Response> {
  const pilely = window.pilely;
  if (!pilely) throw new Error("pilely client not loaded");
  // Settle auth before the first call — see lib/db.ts for why.
  await pilely.ready;
  return pilely.fetch(`${simpleBlobOrigin()}${path}`, init);
}

async function parse<T extends { ok?: boolean }>(res: Response): Promise<T> {
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // empty body (the uniform 404) — fall through with nulls
  }
  const envelope = json as (T & { code?: string; reason?: string }) | null;
  if (!res.ok || envelope?.ok === false) {
    throw new BlobError(
      res.status,
      envelope?.code ?? null,
      envelope?.reason ?? `simple_blob answered ${res.status}`,
    );
  }
  return envelope as T;
}

// Upload nests its record under `blob` (unlike download, which is flat —
// verified against the live service; the shapes are NOT symmetric).
interface UploadAnswer {
  ok?: boolean;
  blob: {
    blob_nanoid: string;
    /** The app the blob bound to — null means it bound to NOTHING (uploaded
     *  under a non-app token) and can never be served. */
    app_id: string | null;
  };
}

/**
 * Multipart upload of one downscaled JPEG. `read_group` is the same empty
 * group the tables use (config.ts) — on a private app that group is the
 * real enforcement boundary at the storage hosts, not decoration.
 * Returns the `blob_nanoid` the caller stores in a record.
 */
export async function uploadBlob(blob: Blob, displayName: string): Promise<string> {
  const form = new FormData();
  // Field names per the upload manual: file part `blob` + text fields.
  // No manual content-type header — the browser writes the multipart
  // boundary itself.
  form.append("blob", blob, "photo.jpg");
  form.append("extension", "jpg");
  form.append("content_type", "image/jpeg");
  form.append("read_group", READ_GROUP);
  form.append("display_name", displayName);
  const res = await pilelyFetch("/upload", {
    method: "POST",
    headers: { accept: "application/json" },
    body: form,
  });
  const answer = await parse<UploadAnswer>(res);
  if (!answer.blob?.blob_nanoid) {
    throw new BlobError(res.status, null, "upload answered without a blob_nanoid");
  }
  if (!answer.blob.app_id) {
    // Misbound blob (see the header comment): unusable forever. Delete it
    // rather than leak quota, then fail loudly.
    await deleteBlob(answer.blob.blob_nanoid).catch(() => undefined);
    throw new BlobError(res.status, null, "blob bound to no app — uploaded under a non-app token");
  }
  return answer.blob.blob_nanoid;
}

interface DownloadAnswer {
  ok?: boolean;
  url: string;
}

/** A fresh short-lived presigned URL for one blob. Render-time only —
 *  never persist the answer (it expires); re-request instead. */
export async function downloadUrl(blobNanoid: string): Promise<string> {
  const res = await pilelyFetch(`/blobs/${blobNanoid}/download`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({}),
  });
  const answer = await parse<DownloadAnswer>(res);
  if (!answer.url) throw new BlobError(res.status, null, "download answered without a url");
  return answer.url;
}

/** Hard delete (content is immutable; there is no undo). A 404 counts as
 *  success so the cascade in plant_store.ts converges on retry. */
export async function deleteBlob(blobNanoid: string): Promise<void> {
  const res = await pilelyFetch(`/blobs/${blobNanoid}/delete`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({}),
  });
  if (res.status === 404) return;
  await parse<{ ok?: boolean }>(res);
}
