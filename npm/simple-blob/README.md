# `@pilely/simple-blob`

A typed client for the `simple_blob` service — the platform's managed file
storage. Wraps all 6 of its POST routes: upload, list, search, download,
delete, access control.

## Install

```sh
npm install @pilely/simple-blob @pilely/core
```

Always install with the scope — `pilely-blob` and similar unscoped names
are not owned by this project and are squattable. `@pilely/core` is a peer
dependency; an app has exactly one facade, never two.

## The misbound-blob trap, made impossible

A blob binds to an app exactly once, at the moment it is uploaded — from
the token that carried the request, never from anything the caller states.
Upload through anything other than the app's own origin (a token minted
for `simple-blob` itself, an owner-surface token) and the blob comes back
`200 OK` with `app_id: null`: it can never be served, permanently, and its
storage quota is still consumed. There is no way to re-bind it after the
fact.

`upload()` and `uploadBase64()` in this package check that condition on
every call. When it fires, they delete the orphan (best effort) and throw
instead of handing back a blob nobody can ever reach. Every request also
goes through `@pilely/core`'s `call()` — never a hand-rolled `fetch` — which
is what makes the binding land correctly in the first place: it runs
through `window.pilely.fetch` on the app's own origin.

## Downloads are render-time only

`downloadUrl()` returns a short-lived, presigned URL. Never cache it —
fetch a fresh one whenever a caller needs to render or download the blob
again.

## Status

This is a pre-1.0 package and moves with the platform. Nothing here is
published to the registry yet. Zero runtime dependencies.

## Error codes, and the two upload walls

Refusals arrive as `PilelyError` with a `code` drawn from
`SimpleBlobErrorCode`. Match on the code, never on the status.

Three can only come from `upload()` / `uploadBase64()`, and they want
different handling:

| Code | Status | Means | Do |
| --- | --- | --- | --- |
| `blob_too_large` | 413 | over the per-blob cap | reject client-side first |
| `storage_exceeded` | 402 | the owner's storage allowance is full | tell the owner — retrying cannot help |
| `quota_unavailable` | 503 | the allowance could not be read | transient, retry is reasonable |

The 402 and the 503 look alike and are not: only the second is worth a retry.

The rest: `not_found` (404, the uniform hide — a denied read and a missing
blob are identical by design), `bad_request` (400), `unauthenticated` (401),
`bad_forwarded_identity` (401), `out_of_traffic_credits` (503),
`rate_limited` (429), `internal` (500).

Note that a download denied to a member answers 404 where the owner would
see a 503 `out_of_traffic_credits` — a member debugging a failing download
is reading a 404 that does not mean what it says.
