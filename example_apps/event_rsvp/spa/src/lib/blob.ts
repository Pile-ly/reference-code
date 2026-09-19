// Cover photos: a thin client over simple_blob
// (manual: https://pilely.app/skill/app_management/simple_blob), used here
// in its PUBLIC shape — the pattern a plant tracker or a private notebook
// never needs.
//
// Flow: host picks a photo → lib/image.ts downscale → uploadCover
// (multipart, through window.pilely.fetch so the request carries THIS
// APP's token) → the event record stores the returned `blob_nanoid` → every
// render calls downloadUrl(id) for a short-lived presigned link → deletes
// are cascaded from stores/event_store.ts (records and blobs never cascade
// on their own).
//
// THE PUBLIC-BLOB PATTERN, which is what makes signed-out visitors see the
// covers at all: upload with `read_group: null` AND `anon_read: true`.
//
//  - `anon_read` is per BLOB, never per app, and it is the only route by
//    which a signed-out visitor may fetch anything from simple_blob.
//  - It cannot coexist with a named `read_group` — if anyone may read, a
//    read group is meaningless, and sending both is a 400.
//  - It is live the moment you set it on a `public` app; on a
//    protected/private app no anonymous credential can exist, so it is
//    inert there (that is why the plant tracker uses an empty group
//    instead).
//  - Multipart has no JSON types, so both fields travel as TEXT: the
//    literal `null` and the literal `true`.
//
// The two rules that make or break ANY simple_blob app still apply:
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
  // Settle auth before the first call — see lib/db.ts for why. This one
  // matters even more here: a signed-out visitor's cover download rides
  // the anonymous credential, which is minted during that same boot.
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
 * Multipart upload of one downscaled JPEG as a PUBLIC cover. Returns the
 * `blob_nanoid` the caller stores on the event record.
 *
 * Only the host ever calls this: uploads are signed-in-only (there is no
 * anonymous write of any kind), and only the host can write `events`.
 * What `anon_read` buys is the other half — signed-out visitors
 * downloading it.
 */
export async function uploadCover(blob: Blob, displayName: string): Promise<string> {
  const form = new FormData();
  // Field names per the upload manual: file part `blob` + text fields.
  // No manual content-type header — the browser writes the multipart
  // boundary itself.
  form.append("blob", blob, "cover.jpg");
  form.append("extension", "jpg");
  form.append("content_type", "image/jpeg");
  // The public-blob pair (see the header): no group, anonymous read on.
  // Both are literal TEXT here — multipart carries no JSON types.
  form.append("read_group", "null");
  form.append("anon_read", "true");
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

/** A fresh short-lived presigned URL for one cover. Render-time only —
 *  never persist the answer (it expires); re-request instead. This is the
 *  one simple_blob route a SIGNED-OUT visitor may call, and only because
 *  the blob carries `anon_read` and this app is `public`. */
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
 *  success so the cascade in event_store.ts converges on retry.
 *
 *  Note whose call this is: a blob belongs to whoever UPLOADED it, not to
 *  the app owner. Covers are uploaded by the host, so the host can delete
 *  them — an app where guests upload files could not clean up after them
 *  from the front end at all. */
export async function deleteBlob(blobNanoid: string): Promise<void> {
  const res = await pilelyFetch(`/blobs/${blobNanoid}/delete`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({}),
  });
  if (res.status === 404) return;
  await parse<{ ok?: boolean }>(res);
}
