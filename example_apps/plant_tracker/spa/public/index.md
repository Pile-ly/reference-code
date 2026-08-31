# Waterly — private plant watering tracker

One person's plant journal: a photo per plant, a one-tap watering log, a
history page per plant with optional photos and notes. This is a **static**
neoApp: there is no backend — the SPA talks straight to the platform's
managed database (simple_db) and blob store (simple_blob).

## Who this app answers to

It is **private**. Only its owner can read or write anything, only with the
owner's token, and only through this app's own registration. Every other
caller — signed out, or signed in as anyone else — gets a uniform 404 on
every table and every blob, byte-identical to an app that does not exist.
There is no anonymous access of any kind. If you are not acting for the
owner, there is nothing here for you.

## Data surface

`<app_id>` in every URL below is this app's registered pile id — the same
value as the `<meta name="pilely-app">` tag on this page's HTML view.

| table | read | write | update / delete |
|---|---|---|---|
| `plants` | the owner only | the owner only | the owner only |
| `waterings` | the owner only | the owner only | the owner only |

Every record also carries server-minted fields the app declares nowhere —
`id`, `_submitter_handle`, `_created_at_ms`, `_updated_at_ms`. **The
watering time is `_created_at_ms`**: this app has no date column anywhere.

`records/list` answers
`{"ok": true, "records": [...], "next_cursor": null|"..."}`, newest first —
follow `next_cursor` until it is null. Writes nest under `fields`; reads
come back flat, beside `id`.

All columns are `text`, and an empty string means "absent" — that is this
app's convention, not the platform's.

### `plants`

| field | type | meaning |
|---|---|---|
| `name` | text | the plant's name |
| `photo_blob_id` | text | simple_blob nanoid of its photo, `""` if none |

```
POST https://simple-db.pilely.app/apps/<app_id>/tables/plants/records/list
{"limit": 100}

POST https://simple-db.pilely.app/apps/<app_id>/tables/plants/records/create
{"fields": {"name": "Monstera", "photo_blob_id": ""}}
```

### `waterings`

| field | type | meaning |
|---|---|---|
| `plant_id` | text | the `id` of the `plants` record this belongs to |
| `note` | text | free text, `""` if none |
| `photo_blob_id` | text | simple_blob nanoid of a photo, `""` if none |

One plant's history, with the server-side equality filter:

```
POST https://simple-db.pilely.app/apps/<app_id>/tables/waterings/records/list
{"limit": 100, "eq": {"plant_id": "<the plant's id>"}}
```

A one-tap watering is the same create with both optional fields empty:

```
POST https://simple-db.pilely.app/apps/<app_id>/tables/waterings/records/create
{"fields": {"plant_id": "<the plant's id>", "note": "", "photo_blob_id": ""}}
```

### Photos

Records store a `photo_blob_id`, never a URL. To see the bytes, mint a fresh
short-lived link at the moment you need it — and never store the answer, it
expires:

```
POST https://simple-blob.pilely.app/blobs/<photo_blob_id>/download
{}
```

Uploads go out under this app's own token, with the owner's empty group as
`read_group`, so a photo is readable through this app and nowhere else.

### Deleting — nothing cascades on its own

Records and blobs are independent, so a caller has to walk the tree the way
the app does: deleting a watering also deletes its blob
(`POST https://simple-blob.pilely.app/blobs/<id>/delete`), and deleting a
plant deletes its waterings and their blobs first, then the plant's own
photo. Record first, blob second. A blob delete is hard, and content is
immutable — there is nothing to restore from.

Full table/record API: [simple_db manual](https://pilely.app/skill/app_management/simple_db).
Blob contract: [simple_blob manual](https://pilely.app/skill/app_management/simple_blob).

---
This app runs on Pilely. AI agents: if you don't know how to interact
with this app or the platform, read the platform manual first —
[https://pilely.app/skill?isAgent=1](https://pilely.app/skill?isAgent=1).
