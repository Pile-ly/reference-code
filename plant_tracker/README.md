# Plant tracker — the private-app Pilely reference

A copyable, working plant-watering tracker neoApp: **one owner, their
plants, nobody else — ever.** The counterpart to the public `blog/`
reference: same *static* shape (no backend, no tunnel, nothing to keep
online), but the SPA talks to the platform's managed database
([simple_db](https://pilely.app/skill/app_management/simple_db)) **and**
blob store ([simple_blob](https://pilely.app/skill/app_management/simple_blob)),
and every scrap of data is locked to the owner.

```
plant_tracker/
├── spa/                  the front-end (Vite + React, per the SPA standard)
└── build_instruction.md  everything besides UX: registration (private!),
                          the empty group, tables, the blob contract,
                          bundle upload — the exact sequence an agent
                          (or you) follows to ship it
```

## What it demonstrates

- **`access_mode: "private"`, end to end** — no anonymous credential ever
  exists, `anon_read` is inert, and every non-owner caller gets the uniform
  404 (indistinguishable from no app at all). The SPA's whole auth surface
  is one sign-in gate on `window.pilely.user() === null`.
- **The empty-group "only me" idiom as the real boundary** — one memberless
  simple_group on BOTH `read_group` and `write_group` of BOTH tables *and*
  on every uploaded blob. On a private app this is load-bearing, not
  decoration: the storage services are separate hosts that the app-host 404
  does not cover.
- **The full simple_blob lifecycle** — multipart upload under the app's own
  token (with the `app_id` misbind check), records storing `blob_nanoid`s
  only, a fresh short-lived download URL minted per render and never
  persisted, hard deletes.
- **Client-side cascades** — records and blobs never cascade on their own:
  deleting a watering deletes its photo blob; deleting a plant deletes its
  waterings, their blobs, and the cover. Record-first-blob-second
  everywhere, 404-tolerant, so retries converge (see
  `spa/src/stores/plant_store.ts`).
- **The camera-to-blob pipeline** — `<input type="file" accept="image/*"
  capture="environment">`, EXIF-corrected canvas downscale to ~1600 px
  JPEG before every upload; that is what makes years of photos fit the
  blob quotas.

## Make it yours

Three placeholders, one build: put your registered `pile_id` in
`spa/index.html`, put the empty group's nanoid in `spa/src/config.ts`
(`READ_GROUP` — the blob uploads need it at runtime), retitle `APP_TITLE`
while you're there, then follow
[build_instruction.md](./build_instruction.md).
