# Plant tracker — the private-app Pilely reference

A copyable, working plant-watering tracker neoApp: **one owner, their
plants, nobody else — ever.** The counterpart to the public `blog/`
reference: same *static* shape (no backend, nothing to keep
online), but the SPA talks to the platform's managed database
([simple_db](https://pilely.app/skill/app_management/simple_db)) **and**
blob store ([simple_blob](https://pilely.app/skill/app_management/simple_blob)),
and every scrap of data is locked to the owner.

```
plant_tracker/
├── spa/                  the front-end (Vite + React, per the SPA standard),
│                         on the @pilely packages; also runs offline in
│                         mock mode
└── build_instruction.md  everything besides UX: registration (private!),
                          the empty group, tables, the blob contract,
                          bundle upload — the exact sequence an agent
                          (or you) follows to ship it
```

`spa/` is the app — the one you run, configure and ship.
`build_instruction.md` is the platform setup around it; the hooks never
create anything, so the group, the database and both tables there are
setup steps.

## Run it

```bash
cd spa
npm install
npm run dev        # the real runtime: needs a registered pile id (see below)
npm run dev:mock   # mock mode: no registration, no network
```

`npm run dev:mock` runs the same app against in-browser fakes of the
platform services, with eight sample plants on first load. Nothing leaves
the page — the served HTML drops the `client.js` tag and the `pilely-app`
meta. Signed out you see the sign-in gate; **Login with Pilely** signs you
in as the mock user, who owns the mock data, so the whole journal is
reachable: the grid, one-tap water and its Undo, the water sheet with a
note and a photo, history deletes, change photo, add and delete a plant. A
signed-in visitor who is *not* the owner (the "nothing here" view) cannot
be reached in mock mode: it has exactly one mock user. The sample plants
carry no waterings (a seeded watering could not point at a seeded plant's
id); water a few and the cards and stats fill in. Records persist in the
browser's `localStorage` — clear the site's data to start from the sample
content again — while uploaded photos live in memory only and fall back to
the generated portrait or tint after a reload.

Under plain `npm run dev` with the committed placeholder pile id, the app
says so instead of rendering a journal whose every call would fail.

## What it demonstrates

- **`access_mode: "private"`, end to end** — no anonymous credential ever
  exists, `anon_read` is inert, and every non-owner caller gets the uniform
  404 (indistinguishable from no app at all). The SPA's whole auth surface
  is one sign-in gate: `<SignedIn>` / `<SignedOut>` from `@pilely/core`,
  on `usePilelyAuth().user === null`.
- **The empty-group "only me" idiom as the real boundary** — one memberless
  simple_group on BOTH `read_group` and `write_group` of BOTH tables *and*
  on every uploaded blob. On a private app this is load-bearing, not
  decoration: the storage services are separate hosts that the app-host 404
  does not cover.
- **The full simple_blob lifecycle** — upload under the app's own token
  (`useUpload` from `@pilely/simple-blob`, with its `app_id` misbind
  check), records storing `blob_nanoid`s only, short-lived download URLs
  through `useBlobUrl`, never persisted, hard deletes.
- **Client-side cascades** — records and blobs never cascade on their own:
  deleting a watering deletes its photo blob; deleting a plant deletes its
  waterings, their blobs, and the cover. Sequential `mutateAsync` calls,
  record-first-blob-second everywhere, 404-tolerant, so retries converge
  (see `spa/src/hooks/usePlantWrites.ts`).
- **The `@pilely` packages** — `<PilelyProvider>` at the root
  (`spa/src/main.tsx`), `usePilelyAuth()` for who is signed in, the
  `@pilely/simple-db` hooks for every read and write (`useRecords` /
  `useRecord` in the components that show the data, optimistic
  `useCreateRecord` / `useUpdateRecord` / `useDeleteRecord`) and the
  `@pilely/simple-blob` hooks for photos.
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

