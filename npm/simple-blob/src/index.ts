// @pilely/simple-blob — React hooks over the simple_blob service: a query
// hook for every read, a mutation hook for every write. Render them inside
// @pilely/core's <PilelyProvider>.

export {
  BLOB_URL_GC_MS,
  BLOB_URL_STALE_MS,
  useBlobSearch,
  useBlobUrl,
  useBlobs,
  useDeleteBlob,
  useSetBlobAccess,
  useUpload,
} from "./hooks.js";
export type { SetBlobAccessInput, UploadInput, UseBlobSearchOptions, UseBlobsOptions } from "./hooks.js";
export type { SetAccessOptions, UploadOptions } from "./api.js";
export type {
  BlobCursor,
  BlobDownload,
  BlobListPage,
  BlobMeta,
  SimpleBlobErrorCode,
} from "./types.js";
