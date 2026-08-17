# Build instruction — shipping the plant tracker

Everything besides the UX (which is already built in `spa/`): how this app
is registered, gets its group, database and tables, and goes live. Follow
top to bottom. Where a step is a platform atomic, this doc names the skill
page and gives this app's **inputs** — the route manuals stay the contract
of record (GET any route with `?isAgent=1` for its manual), so read the
manual at each step and don't trust example payloads here over what it
says.

Prerequisites: a logged-in platform session (JWT) — see
[login](https://pilely.app/skill/account_management/login) — and Node ≥ 20.

## 1. Register the neoApp

Follow [register](https://pilely.app/skill/app_management/register) with
these decisions:

- `serving_mode: "static"` — this app has no backend; the bundle's
  `index.md` is its AI surface. (Permanent choice.)
- `access_mode: "private"` — the whole point of this app. Owner-only, for
  reads and writes alike; `allow_list` doesn't apply; every other caller —
  signed out or signed in as anyone else — gets the uniform 404,
  indistinguishable from no app at all. **No anonymous credential is ever
  minted for a private app**, so `anon_read` is inert everywhere below —
  the mirror image of the blog reference's `public` reasoning.
- Path, title, description: yours (e.g. path `plants`, title
  `{"en": "Waterly"}`).

Registration is metadata-only. **Capture the returned `pile_id`** — the
placeholder step and every simple_db URL need it (it is the `<app_id>` in
those URLs).

## 2. Create the empty group — the "only me" idiom

Everything in this app must be readable and writable by **nobody but the
owner**. simple_db and simple_blob have no "owner only" literal; the idiom
is a group with no members: the owner always passes every check regardless
of groups, so an empty group denies everyone else.

Create one via [simple_group](https://pilely.app/skill/app_management/simple_group):
POST `https://simple-group.pilely.app/groups/create` (a display name like
`"plant tracker owner only"` helps future-you). **Capture the returned
22-char group nanoid; add no members, ever.**

This step comes BEFORE the placeholders on purpose: unlike the blog, this
app's front-end needs the group nanoid baked into the bundle — every photo
upload names it — so the group must exist before you can fill the config.

On a private app this group is load-bearing, not belt-and-braces: the app
host's 404 covers the app's own origin, but simple-db / simple-blob are
separate hosts that answer to any token naming your app. The empty group
on every table and every blob is what actually denies those callers.

## 3. Fill the three placeholders

The committed code is a template with exactly three deployment-specific
values:

1. `spa/index.html` — replace `REPLACE_WITH_YOUR_PILE_ID` in
   `<meta name="pilely-app" content="…">` with the real `pile_id`.
   A bundle uploaded with the placeholder has broken sign-in (the mint
   rejects it); nothing else looks wrong until someone tries.
2. `spa/src/config.ts` — set `READ_GROUP` to step 2's group nanoid. This
   rides in the bundle because the SPA passes it as `read_group` on every
   `simple-blob/upload`. Same trap as the pile id: with the placeholder,
   everything works except photo uploads, which 400 on the unknown group.
3. `spa/src/config.ts` — make `APP_TITLE` yours.

## 4. Create the app's database

POST `https://simple-db.pilely.app/apps/<pile_id>/create` (owner-only;
empty JSON body). One DB per neoApp — see the
[simple_db manual](https://pilely.app/skill/app_management/simple_db).

## 5. Create the two tables

POST `https://simple-db.pilely.app/apps/<pile_id>/tables/create` once per
table (manual: that URL with `?isAgent=1`). Both tables are owner-only —
the empty group on BOTH axes:

| table | columns (all `text`) | `read_group` | `write_group` | `anon_read` | why |
|---|---|---|---|---|---|
| `plants` | `name`, `photo_blob_id` | the empty group | the empty group | omit (inert on a private app) | owner-only, like everything here |
| `waterings` | `plant_id`, `note`, `photo_blob_id` | the empty group | the empty group | omit | owner-only |

Example — `plants` (`waterings` differs only per the table above):

```json
{
  "table": "plants",
  "columns": [
    {"name": "name", "type": "text"},
    {"name": "photo_blob_id", "type": "text"}
  ],
  "read_group": "<the empty group's nanoid>",
  "write_group": "<the empty group's nanoid>"
}
```

Notes that shape the app (all from the
[simple_db manual](https://pilely.app/skill/app_management/simple_db)):

- **The watering time is server-minted.** Every record carries
  `_created_at_ms`; the app declares no date column anywhere — a one-tap
  watering is just `{"plant_id": "…", "note": "", "photo_blob_id": ""}`
  (empty string = absent, by this app's convention).
- **Records store blob ids, never URLs.** Download links expire; the id is
  the durable reference (step 6).
- **Every denial is a uniform 404.** The SPA never infers "signed out"
  or "not allowed" from a 404; sign-in UI gates on
  `window.pilely.user()`, and a signed-in non-owner simply sees "nothing
  here" — exactly like a nonexistent app.
- The ~16 KB serialized-fields cap bounds a note comfortably (the sheet
  caps input at 2 000 chars).

**These two tables are also the app's manual.** `spa/public/index.md` — the
markdown served for `GET /?isAgent=1` — carries the **data surface** the
[SPA standard](https://pilely.app/skill/standards/spa) §7c requires: both
tables, who may read and write each, every column, the literal
`records/list` / `records/create` calls, and how a `photo_blob_id` is turned
back into bytes. It is the only place the owner's agent can learn any of
that, so **a table or column change here is a manual change in the same
edit**. `<app_id>` stays a placeholder in the committed file; the served
copy is read from the app the reader is already talking to.

## 6. Blob storage — no setup step, but know the contract

There is nothing to create in [simple_blob](https://pilely.app/skill/app_management/simple_blob)
— uploads happen at runtime, from the SPA. What matters is the contract
the code in `spa/src/lib/blob.ts` follows:

- **Uploads go out under the app's own token** — `window.pilely.fetch`
  does this — never under a token minted for simple-blob itself. A
  misbound blob "uploads fine" and can never be served by your app,
  permanently; the SPA checks the answer's `app_id` and deletes + errors
  if it is null.
- `read_group` on every upload = **the same empty group** from step 2
  (that's why it's in config.ts).
- **Downloads are minted per render**: `POST blobs/<id>/download` answers
  a short-lived presigned URL. The SPA fetches one every time it shows a
  photo and never stores it — records only ever hold the `blob_nanoid`.
- **Deletes are hard and nothing cascades on its own.** The SPA cascades
  client-side: entry delete → its blob; plant delete → its waterings,
  their blobs, then the cover. Record first, blob second, 404s tolerated —
  a partial failure can orphan a blob (quota-only damage; sweep with
  simple-blob's `/list`) but never leaves a record pointing at a dead one.
- Quotas: **25 MiB per blob, 250 MiB and 500 blobs per user.** The SPA
  downscales every photo to a ~1600 px JPEG (~300–500 KB) before upload —
  that is what makes years of waterings fit; upload originals and you'd
  burn the space quota in a few dozen photos.

## 7. Build and upload the bundle

```bash
cd spa && npm ci && npm run build
```

Zip the **contents** of `dist/` (not the folder), then follow
[update_bundle](https://pilely.app/skill/app_management/update_bundle) to
upload it — and its required
[source_snapshot](https://pilely.app/skill/app_management/source_snapshot)
step so the server's copy of the source stays current. Re-uploading the
bundle is also the edit path later (static app: no backend to restart).

The upload validator enforces what the build already guarantees:
`index.html` + `index.md` at the bundle root, every root folder
`_`-prefixed, root-relative asset URLs.

## 8. Smoke-check the live app

First resolve the app's origin. On a private app the alias
`https://pile.ly/@<handle>/<path>` guards it like everything else:
anonymous or bare-authenticated GETs answer a uniform page, no redirect.
GET the alias **with the owner's JWT and `?isAgent=1`** and read the 302's
`location` — that is the app URL.

The owner path first:

- Sign in → add a plant with a photo → the grid shows it (photo, not
  tint). One-tap Water → toast with Undo; Undo removes the entry (it is a
  real `records/delete`).
- Water from the plant page with a note + photo → the history entry
  renders both. **Reload** — photos still render: the records held only
  blob ids and the page minted fresh links.
- Delete a history entry → confirm → gone, and its blob answers 404 on a
  direct `blobs/<id>/download`.
- Delete the plant → confirm → back home, plant, history and photos all
  gone.

Then the whole point of `private` — the negative matrix:

- **Signed out** at the app URL: the platform serves its own tiny
  bootstrap sign-in page, NOT your bundle — on a non-public app even the
  shell is gated behind sign-in (the SPA's own sign-in gate only ever
  shows after an in-app sign-out). `GET <app url>/?isAgent=1` without a
  token answers the uniform `pile_not_found` 404. No data is reachable.
- **A different signed-in account**: they can even mint a token naming
  your app's uuid — and every surface still answers the uniform 404:
  table lists, writes, blob downloads, the `?isAgent=1` manual, the alias.
  Indistinguishable from an app that doesn't exist. That is the contract
  working, not a bug.
- The owner's agent reads `<app url>/?isAgent=1` with a token minted for
  THIS app (a login JWT is apex-only and 404s on the app host) — that is
  the one call that returns the bundle's `index.md`.
- A bare `curl` on a simple_db/simple_blob URL: 401/404 — expected;
  tokens only exist through the app page or the owner's own agent.
