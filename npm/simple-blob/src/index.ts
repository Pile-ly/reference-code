// @pilely/simple-blob — a typed wrapper over the simple_blob service's 6
// POST routes. See README.md for the misbound-blob trap this package makes
// impossible to hit.

import { call, collectPages, PilelyError } from "@pilely/core";

import type { BlobCursor, BlobDownload, BlobListPage, BlobMeta } from "./types.js";

export type { BlobCursor, BlobDownload, BlobListPage, BlobMeta } from "./types.js";

export interface UploadOptions {
  extension: string;
  content_type: string;
  /** `null` means every user (through the blob's app) — always send the key. */
  read_group: string | null;
  anon_read?: boolean;
  display_name?: string;
}

export interface ListOptions {
  limit?: number;
  extension?: string;
  after_created_time_stamp?: number;
  after_blob_nanoid?: string;
}

export interface SearchOptions {
  limit?: number;
  after_created_time_stamp?: number;
  after_blob_nanoid?: string;
}

export interface SetAccessOptions {
  read_group: string | null;
  anon_read?: boolean;
}

/**
 * Uploaded blobs bind to an app exactly once, at insert, from the token
 * that carried the upload — never from anything the caller states. When a
 * blob comes back with a null `app_id` it was minted under a token with no
 * app binding (a token minted for simple-blob itself, or an owner-surface
 * token) and it can never be served, permanently, with quota still
 * consumed. It also can never be re-bound after the fact. `upload()` and
 * `uploadBase64()` refuse to hand that blob back: they delete the orphan
 * (best effort) and throw this instead.
 */
async function rejectMisboundBlob(blob: BlobMeta): Promise<never> {
  try {
    await deleteBlob(blob.blob_nanoid);
  } catch {
    // best effort — the orphan is unreachable either way
  }
  throw new PilelyError(
    200,
    "blob_misbound",
    "the blob uploaded with no app id and can never be served — upload through the app's own origin, never with a token minted for simple-blob itself",
  );
}

function assertBound(blob: BlobMeta): BlobMeta {
  if (!blob.blob_nanoid) {
    throw new PilelyError(200, "blob_missing_nanoid", "upload answered with no blob_nanoid");
  }
  return blob;
}

/**
 * Uploads via `multipart/form-data`, the default and preferred path: the
 * browser writes its own boundary, and the size cap is applied to what is
 * actually sent (a base64 body inflates by 4/3 before it is checked).
 * Returns the full blob metadata object — take `.blob_nanoid` from it.
 */
export async function upload(file: Blob, options: UploadOptions): Promise<BlobMeta> {
  const form = new FormData();
  form.append("blob", file);
  form.append("extension", options.extension);
  form.append("content_type", options.content_type);
  // The multipart text field has no `null` — the literal string "null" is
  // what the server reads as "everyone via the app".
  form.append("read_group", options.read_group === null ? "null" : options.read_group);
  if (options.anon_read !== undefined) {
    // No JSON boolean on this path either — an exact "true" / "false" string.
    form.append("anon_read", options.anon_read ? "true" : "false");
  }
  if (options.display_name !== undefined) {
    form.append("display_name", options.display_name);
  }

  const json = await call<{ blob: BlobMeta }>({ service: "simple-blob", path: "/upload", form });
  const blob = assertBound(json.blob);
  if (blob.app_id === null) {
    return rejectMisboundBlob(blob);
  }
  return blob;
}

/**
 * Uploads via a JSON body carrying base64 bytes. Prefer `upload()`: base64
 * inflates the body 4/3, and the size cap applies to what is actually
 * sent. This exists for non-browser callers with no `FormData`.
 */
export async function uploadBase64(blobBase64: string, options: UploadOptions): Promise<BlobMeta> {
  const json = await call<{ blob: BlobMeta }>({
    service: "simple-blob",
    path: "/upload",
    body: { blob_base64: blobBase64, ...options },
  });
  const blob = assertBound(json.blob);
  if (blob.app_id === null) {
    return rejectMisboundBlob(blob);
  }
  return blob;
}

/** The paged primitive. Use `listAllBlobs` to walk to the end. */
export async function listBlobs(options: ListOptions = {}): Promise<BlobListPage> {
  const json = await call<{ blobs: BlobMeta[]; next_cursor: BlobCursor | null }>({
    service: "simple-blob",
    path: "/list",
    body: options,
  });
  return { blobs: json.blobs, next_cursor: json.next_cursor };
}

/** Walks `/list` to the end, always requesting the server's max page size
 *  (100) so this never silently doubles round-trips the way an omitted
 *  `limit` (which defaults to 50) would. */
export async function listAllBlobs(options: { extension?: string } = {}): Promise<BlobMeta[]> {
  return collectPages<BlobMeta, BlobCursor>(async (cursor) => {
    const page = await listBlobs({ ...options, limit: 100, ...(cursor ?? {}) });
    return { rows: page.blobs, nextCursor: page.next_cursor };
  });
}

export async function searchBlobs(q: string, options: SearchOptions = {}): Promise<BlobListPage> {
  const json = await call<{ blobs: BlobMeta[]; next_cursor: BlobCursor | null }>({
    service: "simple-blob",
    path: "/search",
    body: { q, ...options },
  });
  return { blobs: json.blobs, next_cursor: json.next_cursor };
}

/** Walks `/search` to the end, always requesting the server's max page
 *  size (100), for the same reason `listAllBlobs` does. */
export async function searchAllBlobs(q: string, options: SearchOptions = {}): Promise<BlobMeta[]> {
  return collectPages<BlobMeta, BlobCursor>(async (cursor) => {
    const page = await searchBlobs(q, { ...options, limit: 100, ...(cursor ?? {}) });
    return { rows: page.blobs, nextCursor: page.next_cursor };
  });
}

/** The returned URL is render-time only — short-lived and presigned. Never
 *  cache it; fetch a fresh one each time it is needed. */
export async function downloadUrl(blobNanoid: string): Promise<BlobDownload> {
  const json = await call<BlobDownload>({
    service: "simple-blob",
    path: `/blobs/${blobNanoid}/download`,
  });
  return { url: json.url, content_type: json.content_type, size_bytes: json.size_bytes };
}

/**
 * Treats a 404 as success, so a caller's delete-cascade converges on
 * retry — the server has no idempotent-success path of its own. This does
 * not defeat the uniform-404 invariant: denied and missing are treated
 * IDENTICALLY, never split apart.
 */
export async function deleteBlob(blobNanoid: string): Promise<void> {
  try {
    await call<{ ok: true }>({ service: "simple-blob", path: `/blobs/${blobNanoid}/delete` });
  } catch (err) {
    if (err instanceof PilelyError && err.status === 404) {
      return;
    }
    throw err;
  }
}

export async function setBlobAccess(blobNanoid: string, options: SetAccessOptions): Promise<BlobMeta> {
  const json = await call<{ blob: BlobMeta }>({
    service: "simple-blob",
    path: `/blobs/${blobNanoid}/access/set`,
    body: options,
  });
  return json.blob;
}
