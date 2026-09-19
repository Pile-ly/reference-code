/** Every `code` the simple_blob service can put in a `{ok:false, code, reason}`
 *  refusal. Exhaustive as of the 2026-09 review, checked against the service's
 *  `response_json.rs` and `render.rs`.
 *
 *  The three worth handling explicitly on `upload`:
 *  - `blob_too_large` (413) — over the per-blob cap.
 *  - `storage_exceeded` (402) — the owner's storage allowance is full. The
 *    fix is the owner's, not the caller's; say so rather than retrying.
 *  - `quota_unavailable` (503) — the allowance could not be read. Transient;
 *    retry is reasonable here, unlike the 402. */
export type SimpleBlobErrorCode =
  | "unauthenticated"
  | "bad_forwarded_identity"
  | "bad_request"
  | "not_found"
  | "blob_too_large"
  | "storage_exceeded"
  | "quota_unavailable"
  | "out_of_traffic_credits"
  | "rate_limited"
  | "internal";

/**
 * A blob's full metadata. Owner and billing ids are never on the wire —
 * `app_id` is the one access-v3 field that is readable but not writable
 * (it is stamped once, from the uploader's token, at insert): an app that
 * cannot see which app a blob belongs to cannot explain to a user why a
 * blob is unreachable.
 */
export interface BlobMeta {
  blob_nanoid: string;
  display_name: string | null;
  extension: string;
  content_type: string;
  size_bytes: number;
  /** `null` when the blob was uploaded under a token with no app binding —
   *  a blob in that state can never be served. `upload()` below refuses to
   *  hand one back; this field exists for completeness on reads. */
  app_id: string | null;
  /** `null` means every user (through the blob's app). */
  read_group: string | null;
  anon_read: boolean;
  created_time_stamp: number;
}

/** Both keys present together, or neither — never one alone. */
export interface BlobCursor {
  after_created_time_stamp: number;
  after_blob_nanoid: string;
}

export interface BlobListPage {
  blobs: BlobMeta[];
  next_cursor: BlobCursor | null;
}

/**
 * The presigned answer to `download`. Render-time only: short-lived, so
 * never cache `url` — fetch a fresh one each time a caller needs to render
 * or download the blob.
 */
export interface BlobDownload {
  url: string;
  content_type: string;
  size_bytes: number;
}
