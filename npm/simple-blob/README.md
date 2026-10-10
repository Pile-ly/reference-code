# `@pilely/simple-blob`

React hooks for the `simple_blob` service — the platform's managed file storage. A query hook for every read, a mutation hook for every write. Render them inside `@pilely/core`'s `<PilelyProvider>`.

## Hooks

| Hook | Wraps | Kind |
| --- | --- | --- |
| `useBlobs({ extension?, limit? })` | `/list`, paged | infinite query; `data` is the flattened `BlobMeta[]` |
| `useBlobSearch(q, { limit? })` | `/search`, paged | infinite query; an `undefined` `q` disables it |
| `useAppBlobs(appId, { extension?, limit?, uploaderUserId? })` | `/apps/{app_id}/list`, paged | infinite query over every blob bound to the app, whoever uploaded it — the app owner's view; an `undefined` `appId` disables it |
| `useAppBlobSearch(appId, q, { limit?, uploaderUserId? })` | `/apps/{app_id}/search`, paged | infinite query; an `undefined` `appId` or `q` disables it |
| `useBlobUrl(blobNanoid)` | `/blobs/{id}/download` | query; `data` is `{ url, content_type, size_bytes }`; an `undefined` id disables it |
| `useUpload()` | `/upload` | mutation, `{ file, extension, content_type, read_group, anon_read?, display_name? }` (or `base64` in place of `file`) |
| `useDeleteBlob()` | `/blobs/{id}/delete` | mutation, the blob's nanoid |
| `useSetBlobAccess()` | `/blobs/{id}/access/set` | mutation, `{ blobNanoid, read_group, anon_read? }` |

Every write waits for the server: an upload has nothing to show before its bytes land.

`useBlobs` and `useBlobSearch` answer the signed-in caller's own uploads. `useAppBlobs` and `useAppBlobSearch` answer every blob bound to one app — a visitor's uploads included — and only to that app's current owner, from their owner surface or through that same app; anyone else, and a call through any other app, gets the uniform 404 in `error`. Pass `appId()` from `@pilely/core` for the app the page runs in. `uploaderUserId` (a user id) narrows the listing to one uploader's blobs.

## Who owns a blob, and who pays for it

Every blob carries two read-only ids, stamped at upload:

- `uploader_user_id` — the user who uploaded it. The uploader can always list, download, re-scope and delete it, from their owner surface or through the blob's app.
- `payer_user_id` — who its storage and downloads are charged to. A blob uploaded through an app is billed to the **app's owner**, whoever uploaded it; a blob uploaded with no app, or before app owners paid, is billed to its uploader.

The app's owner (and a box of the app) can download, re-scope and delete every blob bound to their app, as well as list it. A blob's `read_group` may be a group owned by its uploader or by the app's owner, so a visitor can make an upload private to the owner by picking one of the owner's groups. On a blob the app's owner pays for and someone else uploaded, only the app's owner can turn `anon_read` on: the uploader's `upload` or `useSetBlobAccess` with `anon_read: true` fails with `bad_request` (400), and the uploader's own access change always leaves `anon_read` off.

Deleting an app, or its owner's account, permanently deletes every blob other users uploaded through it.

## What each write refreshes

| Write | Invalidates |
| --- | --- |
| upload | every `useBlobs`, `useBlobSearch`, `useAppBlobs` and `useAppBlobSearch` |
| delete / set access on blob `B` | every `useBlobs`, `useBlobSearch`, `useAppBlobs` and `useAppBlobSearch`, and `useBlobUrl(B)` |

## Example

```tsx
import { useBlobUrl, useUpload } from "@pilely/simple-blob";

function Cover({ blob }: { blob: string | undefined }) {
  const { data } = useBlobUrl(blob);
  return data ? <img src={data.url} alt="" /> : null;
}

function CoverPicker({ onUploaded }: { onUploaded: (blob: string) => void }) {
  const upload = useUpload();
  return (
    <>
      <input
        type="file"
        accept="image/*"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          const blob = await upload.mutateAsync({
            file,
            extension: file.name.split(".").pop() ?? "bin",
            content_type: file.type,
            read_group: null,
          });
          onUploaded(blob.blob_nanoid);
        }}
      />
      {upload.error && <p role="alert">{upload.error.message}</p>}
    </>
  );
}
```

## Presigned URL lifetime

`useBlobUrl` serves a presigned URL the service mints with at least 300 s of life left. The hook treats a URL as stale after **240 s** (`BLOB_URL_STALE_MS`), fetches a fresh one every 240 s while a component shows it, and drops it **50 s** (`BLOB_URL_GC_MS`) after the last component stops showing it — no URL older than 290 s is ever handed out. Render `data.url` directly; never store it.

## Misbound blobs are refused

A blob binds to an app once, at upload, from the token that carried the request. Every upload goes through `window.pilely.fetch` on the app's own origin, so it binds correctly. If one still comes back bound to no app, `useUpload` deletes it and fails with `PilelyError` code `blob_misbound` instead of handing back a blob nobody can reach.

## Query keys

| Key | Query |
| --- | --- |
| `["pilely", "simple-blob", "list", { extension, limit }]` | `useBlobs` |
| `["pilely", "simple-blob", "search", q, { limit }]` | `useBlobSearch` |
| `["pilely", "simple-blob", "app-list", appId, { extension, limit, uploaderUserId }]` | `useAppBlobs` |
| `["pilely", "simple-blob", "app-search", appId, q, { limit, uploaderUserId }]` | `useAppBlobSearch` |
| `["pilely", "simple-blob", "url", blobNanoid]` | `useBlobUrl` |

## Mock mode

Importing this package in a build made with `VITE_PILELY_MOCK=1` registers an in-browser fake of `simple_blob` behind `@pilely/core`'s mock runtime — nothing else to call.

The fake keeps uploaded bytes in memory, lists and searches with the service's cursors, and answers `useBlobUrl` with a `blob:` URL the page can render directly. Every blob is bound to the mock app id. A missing blob answers the bare 404. It stores `read_group` and `anon_read` but enforces neither, and has no size cap, storage wall, quota or traffic credits. Its state is memory-only: blobs are gone after a reload.

The mock user owns the mock app, so `useAppBlobs(appId())` lists every blob, and every blob's `uploader_user_id` and `payer_user_id` are the mock user's id. The fake bills any other uploader's blob to the app's owner, refuses that uploader's `anon_read: true` with `bad_request`, and answers anyone but the uploader and the owner the bare 404 on a delete or access change.

Writes and listings need a signed-in user: a signed-out call answers the uniform bare 404, which reaches the hook's `error` as `PilelyError(404, null)`. See [`@pilely/core`](../core#mock-mode) for the switch, `seedMock()` and `resetMock()`.

## Error codes

Refusals arrive as `PilelyError` in the hook's `error`, with a `code` drawn from `SimpleBlobErrorCode`. Match on the code, never on the status. Three come only from an upload, and want different handling:

| Code | Status | Means | Do |
| --- | --- | --- | --- |
| `blob_too_large` | 413 | over the per-blob cap | reject client-side first |
| `storage_exceeded` | 402 | the payer's storage allowance is full (only the payer sees it) | tell the owner — retrying cannot help |
| `quota_unavailable` | 503 | the allowance could not be read | transient, retry is reasonable |

The rest: `not_found` (404, the uniform hide), `bad_request` (400), `unauthenticated` (401), `bad_forwarded_identity` (401), `out_of_traffic_credits` (503), `rate_limited` (429, over a `@simple_limiter` policy the app's owner set on this app's blob routes; root answers it with a `Retry-After` header), `internal` (500). A refusal caused by the payer's storage or balance shows its real code only to the payer: a visitor uploading through an app whose owner's allowance or balance is out gets the uniform 404 `not_found`, as does a download or access change denied for the payer's balance, where the payer would see 402 `storage_exceeded` or 503 `out_of_traffic_credits`.

Deleting a blob that is already gone, or was never visible, counts as success.

## Install

```sh
npm install @pilely/simple-blob @pilely/core @tanstack/react-query
```

`@pilely/core`, `react` (`^18.3 || ^19`) and `@tanstack/react-query` (`^5`) are peer dependencies. Always install with the scope — unscoped names like `pilely-blob` are not owned by this project. This is a pre-1.0 package and moves with the platform.
