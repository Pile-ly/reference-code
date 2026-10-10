/** Every `code` the simple_blob service can put in a `{ok:false, code, reason}`
 *  refusal. Exhaustive as of the 2026-09 review, checked against the service's
 *  `response_json.rs` and `render.rs`.
 *
 *  The three worth handling explicitly on `upload`:
 *  - `blob_too_large` (413) — over the per-blob cap.
 *  - `storage_exceeded` (402) — the payer's storage allowance is full (for
 *    an upload through an app, the app owner's; any caller but the payer
 *    gets the uniform 404 instead). The fix is the owner's, not the
 *    caller's; say so rather than retrying.
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
  /** 429 — over a `@simple_limiter` policy the app's owner set on this
   *  app's blob routes; root answers it with a `Retry-After` header. */
  | "rate_limited"
  | "internal";

/**
 * A blob's full metadata. `app_id`, `uploader_user_id` and `payer_user_id`
 * are readable but never writable: all three are stamped once, at insert,
 * from the token that carried the upload. An app that cannot see which app
 * a blob belongs to cannot explain to a user why a blob is unreachable.
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
  /** The user who uploaded the blob — its owner. */
  uploader_user_id: string;
  /** Who the blob's storage and downloads are charged to. For a blob
   *  uploaded through an app, that app's owner, whoever uploaded it; for a
   *  blob uploaded with no app, or before app owners paid, the uploader.
   *  When this is the app's owner and `uploader_user_id` is someone else,
   *  only the app's owner can turn `anon_read` on (the uploader gets
   *  `400 bad_request`). */
  payer_user_id: string;
  created_time_stamp: number;
}

/** Both keys present together, or neither — never one alone. */
export interface BlobCursor {
  after_created_time_stamp: number;
  after_blob_nanoid: string;
}

/** Options for one page of an app's listing (`POST /apps/{app_id}/list`):
 *  every blob bound to the app, whoever uploaded it. Only the app's current
 *  owner is answered — from their owner surface or through that same app;
 *  anyone else gets the uniform 404. */
export interface AppBlobListOptions {
  /** Rows per page; the server defaults to 50 and caps at 100. */
  limit?: number;
  /** Only blobs with this extension. */
  extension?: string;
  /** Only blobs this user uploaded (a user id, a UUID). */
  uploaderUserId?: string;
  /** The previous page's `next_cursor`; omit (or `null`) for the first page. */
  cursor?: BlobCursor | null;
}

/** Options for one page of an app's search (`POST /apps/{app_id}/search`),
 *  under the same rule as `AppBlobListOptions`. */
export interface AppBlobSearchOptions {
  limit?: number;
  uploaderUserId?: string;
  cursor?: BlobCursor | null;
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
