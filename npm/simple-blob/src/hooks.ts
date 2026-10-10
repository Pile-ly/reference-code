import { serviceQueryKey, useServiceInfiniteQuery, useServiceMutation, useServiceQuery } from "@pilely/core";
import type { QueryKey, UseInfiniteQueryResult, UseMutationResult, UseQueryResult } from "@tanstack/react-query";

import {
  deleteBlob,
  downloadUrl,
  listAppBlobs,
  listBlobs,
  searchAppBlobs,
  searchBlobs,
  setBlobAccess,
  upload,
  uploadBase64,
} from "./api.js";
import type { SetAccessOptions, UploadOptions } from "./api.js";
import type { BlobCursor, BlobDownload, BlobMeta } from "./types.js";

/** `["pilely", "simple-blob", "list", options]` — every `useBlobs`. */
const listsKey = (): QueryKey => serviceQueryKey("simple-blob", "list");
/** `["pilely", "simple-blob", "search", q, options]` — every `useBlobSearch`. */
const searchesKey = (): QueryKey => serviceQueryKey("simple-blob", "search");
/** `["pilely", "simple-blob", "app-list", appId, options]` — every `useAppBlobs`. */
const appListsKey = (): QueryKey => serviceQueryKey("simple-blob", "app-list");
/** `["pilely", "simple-blob", "app-search", appId, q, options]` — every `useAppBlobSearch`. */
const appSearchesKey = (): QueryKey => serviceQueryKey("simple-blob", "app-search");
/** `["pilely", "simple-blob", "url", blobNanoid]` */
const urlKey = (blobNanoid: string | undefined): QueryKey => serviceQueryKey("simple-blob", "url", blobNanoid);

/**
 * How long `useBlobUrl` serves one presigned URL. The service guarantees
 * every URL it mints at least 300 s of remaining life; a cached URL goes
 * stale after 240 s, is re-fetched every 240 s while a component shows it,
 * and is dropped 50 s after the last component stops showing it — so no
 * URL older than 290 s is ever handed out.
 */
export const BLOB_URL_STALE_MS = 240_000;
export const BLOB_URL_GC_MS = 50_000;

export interface UseBlobsOptions {
  /** Only blobs with this extension. */
  extension?: string;
  /** Rows per page; the server defaults to 50 and caps at 100. */
  limit?: number;
}

export interface UseBlobSearchOptions {
  limit?: number;
}

export interface UseAppBlobsOptions {
  /** Only blobs with this extension. */
  extension?: string;
  /** Rows per page; the server defaults to 50 and caps at 100. */
  limit?: number;
  /** Only blobs this user uploaded (a user id, a UUID). */
  uploaderUserId?: string;
}

export interface UseAppBlobSearchOptions {
  limit?: number;
  /** Only blobs this user uploaded (a user id, a UUID). */
  uploaderUserId?: string;
}

/** Every blob list and search a write can change: the caller's own
 *  (`useBlobs`, `useBlobSearch`) and the app owner's (`useAppBlobs`,
 *  `useAppBlobSearch`). */
const listingKeys = (): QueryKey[] => [listsKey(), searchesKey(), appListsKey(), appSearchesKey()];

/** Upload input: the file (multipart — the default) or base64 bytes, plus
 *  the upload options. */
export type UploadInput = UploadOptions & ({ file: Blob } | { base64: string });

export interface SetBlobAccessInput extends SetAccessOptions {
  blobNanoid: string;
}

function cursorFields(cursor: BlobCursor | null): Partial<BlobCursor> {
  return cursor ?? {};
}

/** The app's blobs, newest first, as an infinite query: `data` is every
 *  loaded blob, flattened. */
export function useBlobs(options: UseBlobsOptions = {}): UseInfiniteQueryResult<BlobMeta[], Error> {
  const { extension, limit } = options;
  return useServiceInfiniteQuery<BlobMeta, BlobCursor>("useBlobs", {
    queryKey: [...listsKey(), { extension, limit }],
    fetchPage: async (cursor) => {
      const page = await listBlobs({ extension, limit, ...cursorFields(cursor) });
      return { rows: page.blobs, nextCursor: page.next_cursor };
    },
  });
}

/** Blobs whose name matches `q`, as an infinite query. An `undefined` `q`
 *  disables the query. */
export function useBlobSearch(
  q: string | undefined,
  options: UseBlobSearchOptions = {},
): UseInfiniteQueryResult<BlobMeta[], Error> {
  const { limit } = options;
  return useServiceInfiniteQuery<BlobMeta, BlobCursor>("useBlobSearch", {
    queryKey: [...searchesKey(), q, { limit }],
    fetchPage: async (cursor) => {
      const page = await searchBlobs(q as string, { limit, ...cursorFields(cursor) });
      return { rows: page.blobs, nextCursor: page.next_cursor };
    },
    enabled: q !== undefined,
  });
}

/**
 * Every blob bound to `appId`, whoever uploaded it, newest first, as an
 * infinite query: `data` is every loaded blob, flattened. For the app's
 * owner only — from their owner surface or through that same app; anyone
 * else gets the uniform 404 in `error`. An `undefined` `appId` disables the
 * query.
 */
export function useAppBlobs(
  appId: string | undefined,
  options: UseAppBlobsOptions = {},
): UseInfiniteQueryResult<BlobMeta[], Error> {
  const { extension, limit, uploaderUserId } = options;
  return useServiceInfiniteQuery<BlobMeta, BlobCursor>("useAppBlobs", {
    queryKey: [...appListsKey(), appId, { extension, limit, uploaderUserId }],
    fetchPage: async (cursor) => {
      const page = await listAppBlobs(appId as string, { extension, limit, uploaderUserId, cursor });
      return { rows: page.blobs, nextCursor: page.next_cursor };
    },
    enabled: appId !== undefined,
  });
}

/** The blobs bound to `appId` whose name matches `q`, as an infinite
 *  query, for the app's owner only (see `useAppBlobs`). An `undefined`
 *  `appId` or `q` disables the query. */
export function useAppBlobSearch(
  appId: string | undefined,
  q: string | undefined,
  options: UseAppBlobSearchOptions = {},
): UseInfiniteQueryResult<BlobMeta[], Error> {
  const { limit, uploaderUserId } = options;
  return useServiceInfiniteQuery<BlobMeta, BlobCursor>("useAppBlobSearch", {
    queryKey: [...appSearchesKey(), appId, q, { limit, uploaderUserId }],
    fetchPage: async (cursor) => {
      const page = await searchAppBlobs(appId as string, q as string, { limit, uploaderUserId, cursor });
      return { rows: page.blobs, nextCursor: page.next_cursor };
    },
    enabled: appId !== undefined && q !== undefined,
  });
}

/**
 * A presigned download URL for one blob (`data.url`, plus its content type
 * and size). An `undefined` id disables the query, so
 * `useBlobUrl(post?.cover_blob)` needs no condition around it. The URL is
 * replaced before it can expire: see `BLOB_URL_STALE_MS`.
 */
export function useBlobUrl(blobNanoid: string | undefined): UseQueryResult<BlobDownload, Error> {
  return useServiceQuery<BlobDownload>("useBlobUrl", {
    queryKey: urlKey(blobNanoid),
    queryFn: () => downloadUrl(blobNanoid as string),
    enabled: blobNanoid !== undefined,
    staleTime: BLOB_URL_STALE_MS,
    gcTime: BLOB_URL_GC_MS,
    refetchInterval: BLOB_URL_STALE_MS,
    refetchIntervalInBackground: true,
  });
}

/**
 * Uploads one blob and answers its metadata — keep `.blob_nanoid`. A blob
 * that came back bound to no app is deleted again and the write fails with
 * `PilelyError` code `blob_misbound`. Not optimistic: nothing shows before
 * the bytes landed.
 */
export function useUpload(): UseMutationResult<BlobMeta, Error, UploadInput> {
  return useServiceMutation<BlobMeta, UploadInput>("useUpload", {
    mutationFn: (input) => {
      if ("file" in input) {
        const { file, ...options } = input;
        return upload(file, options);
      }
      const { base64, ...options } = input;
      return uploadBase64(base64, options);
    },
    invalidates: () => listingKeys(),
  });
}

/** Deletes one blob. A blob that is already gone (or never visible) counts
 *  as deleted. */
export function useDeleteBlob(): UseMutationResult<void, Error, string> {
  return useServiceMutation<void, string>("useDeleteBlob", {
    mutationFn: deleteBlob,
    invalidates: (_none, blobNanoid) => [...listingKeys(), urlKey(blobNanoid)],
  });
}

/** Replaces one blob's read access. */
export function useSetBlobAccess(): UseMutationResult<BlobMeta, Error, SetBlobAccessInput> {
  return useServiceMutation<BlobMeta, SetBlobAccessInput>("useSetBlobAccess", {
    mutationFn: ({ blobNanoid, ...options }) => setBlobAccess(blobNanoid, options),
    invalidates: (_blob, { blobNanoid }) => [...listingKeys(), urlKey(blobNanoid)],
  });
}
