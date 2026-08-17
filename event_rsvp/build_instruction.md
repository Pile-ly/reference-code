# Build instruction — shipping the event RSVP app

Everything besides the UX (which is already built in `spa/`): how this app
is registered, gets its database, group and tables, and goes live. Follow
top to bottom. Where a step is a platform atomic, this doc names the skill
page and gives this app's **inputs** — the route manuals stay the contract
of record (GET any route with `?isAgent=1` for its manual), so read the
manual at each step and don't trust example payloads here over what it
says.

Prerequisites: a logged-in platform session (JWT) — see
[login](https://pilely.app/skill/account_management/login) — and Node ≥ 20.

**One thing to get right before step 3, or three steps in a row will fail
with `login_required`:** your login token works on `pilely.app` and nowhere
else. The managed storage services are separate apps, so every call to them
needs a token minted for the right target — see
[login § Using the token](https://pilely.app/skill/account_management/login).
The rule is not uniform, and the two halves fail differently:

| calling | mint `"target"` as | why |
|---|---|---|
| `simple-db` / `simple-blob` | **THIS app's `pile_id`** | they are called *on behalf of an app*, and read the token as proof of which app is calling — that is what the table rules and the blob's app binding are written against |
| `simple-group` | **simple-group's own pile uuid** (read it from its shell's `<meta name="pilely-app">`) | the normal rule: a host accepts a token minted for itself |

```bash
curl -X POST https://pilely.app/~/mint/app_id_token \
  -H "Authorization: Bearer <login-token>" -H "content-type: application/json" \
  -d '{"target": "<pile uuid per the table above>"}'
```

Getting the storage ones backwards fails *silently*: a token minted for
`simple-db` itself names no calling app and still works for the owner (so
testing alone won't reveal it), and one minted for `simple-blob` uploads a
blob bound to no app at all — a `200` with a real id and a file your app can
never serve.

## 1. Register the neoApp

Follow [register](https://pilely.app/skill/app_management/register) with
these decisions:

- `serving_mode: "static"` — this app has no backend; the bundle's
  `index.md` is its AI surface. (Permanent choice.)
- `access_mode: "public"` — a guest list starts with people being able to
  READ the invitation. Public is also the precondition for **both**
  anonymous-read opt-ins this app uses: the `events` table's `anon_read`
  (step 5) and the cover blobs' `anon_read` (step 6). On a
  `protected`/`private` app no anonymous credential can exist, so both are
  inert there — the mirror image of the plant tracker's reasoning.
- Path, title, description: yours (e.g. path `supper_club`, title
  `{"en": "Sunset Supper Club"}`).

Registration is metadata-only. **Capture the returned `pile_id`** — the
next step and every simple_db URL need it (it is the `<app_id>` in those
URLs).

## 2. Fill the two placeholders

The committed code is a template with exactly two deployment-specific
values, plus the club's own branding:

1. `spa/index.html` — replace `REPLACE_WITH_YOUR_PILE_ID` in
   `<meta name="pilely-app" content="…">` with the real `pile_id`.
   A bundle uploaded with the placeholder has broken sign-in (the mint
   rejects it); nothing else looks wrong until someone tries.
2. `spa/src/config.ts` — set `OWNER_HANDLE` to the host's handle (no `@`).
   Your session's handle is in the login skill's `/~/me` answer.
3. **The club itself** — also in `spa/src/config.ts`: `HOST.name`,
   `HOST.tagline`, `HOST.mark`. Mirror the same facts in
   `spa/public/index.md`, which is the identical description for AI agents
   (a static app's `index.md` is served for `GET /?isAgent=1`).

Note what is **not** a placeholder: the empty group's nanoid. Unlike the
[plant tracker](../plant_tracker/build_instruction.md), where every photo
upload names a read group and the group therefore ships inside the bundle,
this app's covers are public blobs (`read_group: null`), so the group is
used only server-side in step 5 and never appears in the front end.

## 3. Create the app's database

POST `https://simple-db.pilely.app/apps/<pile_id>/create` (owner-only;
empty JSON body). One DB per neoApp — see the
[simple_db manual](https://pilely.app/skill/app_management/simple_db).

## 4. Create the empty group — the "only me" idiom

The RSVPs must be readable, and the events writable, by **nobody but the
host**. simple_db has no "owner only" literal; the idiom is a group with no
members: the owner always passes every check regardless of groups, so an
empty group denies everyone else.

Create one via [simple_group](https://pilely.app/skill/app_management/simple_group):
POST `https://simple-group.pilely.app/groups/create` (a display name like
`"supper club host only"` helps future-you). **Capture the returned 22-char
group nanoid; add no members, ever.**

One group serves both tables, on opposite axes — that is the whole trick of
the next step.

## 5. Create the two tables — the two-sided pattern

POST `https://simple-db.pilely.app/apps/<pile_id>/tables/create` once per
table (manual: that URL with `?isAgent=1`). The two tables are mirror
images, and between them they are the app:

| table | columns | `read_group` | `anon_read` | `write_group` | why |
|---|---|---|---|---|---|
| `events` | `title` text, `starts_at_ms` integer, `tz` text, `place` text, `description` text, `cover_blob_id` text, `canceled` boolean | `null` | `true` | the empty group | the host publishes; the whole world reads, signed out included |
| `rsvps` | `event_id` text, `status` text, `party` integer, `note` text | the empty group | omit | `null` | any signed-in guest writes; **only the host reads** |

```json
{
  "table": "events",
  "columns": [
    {"name": "title", "type": "text"},
    {"name": "starts_at_ms", "type": "integer"},
    {"name": "tz", "type": "text"},
    {"name": "place", "type": "text"},
    {"name": "description", "type": "text"},
    {"name": "cover_blob_id", "type": "text"},
    {"name": "canceled", "type": "boolean"}
  ],
  "read_group": null,
  "write_group": "<the empty group's nanoid>",
  "anon_read": true
}
```

```json
{
  "table": "rsvps",
  "columns": [
    {"name": "event_id", "type": "text"},
    {"name": "status", "type": "text"},
    {"name": "party", "type": "integer"},
    {"name": "note", "type": "text"}
  ],
  "read_group": "<the empty group's nanoid>",
  "write_group": null
}
```

Notes that shape the app (all from the
[simple_db manual](https://pilely.app/skill/app_management/simple_db)):

- **`write_group: null` means every signed-in user** — deliberate, never a
  default. There is still no anonymous write of any kind, which is why the
  RSVP card gates on sign-in.
- **An RSVP is a one-way postcard.** Updating or deleting a record is the
  OWNER's alone, and the empty read group means a guest's `list`/`get`
  answers the uniform 404. So a guest cannot read their answer back and
  cannot edit it: **changing an RSVP is sending another row**, and the host
  portal keeps the latest row per `_submitter_handle` (marking anyone with
  more than one as "changed"). Design the guest screen for that or it will
  lie to people — this one shows a per-device `localStorage` memo and says
  so in as many words.
- **Same rule, used the other way**: because update/delete belong to the
  owner, the host CAN purge other people's RSVP rows when deleting an
  event.
- **Anonymous readers get one field less** — rows from an `anon_read` table
  come back without `_submitter_user_id` (`_submitter_handle` stays).
- **Typed columns are worth using.** `starts_at_ms` is an `integer` and
  `canceled` a `boolean`; simple_db validates on write and returns them as
  real JSON numbers/booleans, so no screen parses strings. The time model
  is one instant plus the host's IANA zone (`tz`) — enough to sort events,
  split upcoming from past, and show a dinner at the host's 6:30 pm to a
  guest on another continent.
- **Every denial is a uniform 404.** The SPA never infers "signed out" from
  a status code; sign-in UI gates on `window.pilely.user()`, which stays
  `null` on the anonymous token a public app hands signed-out visitors.
- Records cap at ~16 KB of serialized fields; the form caps the description
  at 2 000 characters and an RSVP note at 280.

**These two tables are also the app's manual.** `spa/public/index.md` — the
markdown served for `GET /?isAgent=1` — carries the **data surface** the
[SPA standard](https://pilely.app/skill/standards/spa) §7c requires: both
tables, who may read and write each, every column, the literal
`records/list` / `records/create` calls, the cover-blob download, and the
host's rollup (latest row per handle wins), which no reader could infer from
the rows. It is the only place a guest or an agent can learn any of it, so
**a table or column change here is a manual change in the same edit**.
`<app_id>` stays a placeholder in the committed file; the served copy is
read from the app the reader is already talking to.

## 6. Cover photos — the public-blob contract

There is nothing to create in [simple_blob](https://pilely.app/skill/app_management/simple_blob)
— uploads happen at runtime, from the SPA. What matters is the contract
`spa/src/lib/blob.ts` follows, and this app uses simple_blob's **public**
shape, which the other reference apps don't:

- **`read_group: null` + `anon_read: true` on every upload.** That pair is
  what lets a signed-OUT visitor see the cover. `anon_read` is per BLOB
  (never per app), it **cannot coexist with a named read group** (sending
  both is a `400`), and it is live the moment you set it on a `public` app.
  Multipart carries no JSON types, so both fields go as literal text:
  `read_group=null`, `anon_read=true`.
- **Uploads go out under the app's own token** — `window.pilely.fetch` does
  this — never under a token minted for simple-blob itself. A misbound blob
  "uploads fine" and can never be served by your app, permanently; the SPA
  checks the answer's `app_id` and deletes + errors if it is null.
- **The upload answer nests, the download answer doesn't.** `upload` returns
  `{ok, blob: {blob_nanoid, app_id, …}}` while `download` returns
  `{ok, url, …}` — verified against the live service; don't assume symmetry.
- **Downloads are minted per render**: `POST blobs/<id>/download` answers a
  short-lived presigned URL. Fetch one every time you show a photo and
  never store it — records only ever hold the `blob_nanoid`.
- **Only the uploader may delete a blob** — not the app owner. Covers are
  uploaded by the host, so the host can replace and delete them. (An app
  where *guests* upload files could not clean up after them at all; that is
  a reason to take the backend branch.)
- **Content is immutable**, so replacing a cover is: upload the new blob →
  update the record's `cover_blob_id` → delete the old blob, in that order.
- **Deletes are hard and nothing cascades.** Deleting an event is a
  client-side cascade: that event's RSVP rows → the event record → the
  cover blob. Records first, blob last, 404s tolerated — a partial failure
  can orphan a blob (quota-only damage, sweepable with simple-blob's
  `/list`) but never leaves a live record pointing at a dead one.
- Quotas: **25 MiB per blob, 250 MiB and 500 blobs per user.** The SPA
  downscales every cover to a ~1600 px JPEG (~300–500 KB) before upload.

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

Resolve the app's URL from the handle alias
`https://pile.ly/@<handle>/<path>` → `302`. On a public app that
redirect works for anyone, signed in or not.

**Signed out** — the half most apps get wrong:

- The home page renders the event list. That is `anon_read` on `events`
  working through the app's own origin. (It works only there: the anonymous
  credential is minted by the app page, so a bare `curl` against the table
  gets a 401 — expected, not a failure.)
- **The cover photos render too** — the anonymous credential reaching
  simple_blob, one `POST blobs/<id>/download` per cover. If the tint
  placeholder shows instead of the photo, the blob is missing its
  `anon_read` flag.
- An event's page deep-links and reloads fine, and its RSVP card shows the
  sign-in gate rather than the form.
- `GET <app url>/?isAgent=1` returns the bundle's `index.md`.

**Signed in as a non-host**:

- Send an RSVP; then send a different one for the same event. The device
  memo updates to the latest — and nothing on the page ever shows another
  guest's answer or a total.
- A direct `records/list` on `rsvps` as that user answers the uniform 404.
- No "Host portal" link appears, and typing `/admin` shows the same
  "nothing here" panel a stranger gets.

**Signed in as the host**:

- Create an event with a cover photo; it appears publicly at once.
- Edit it and replace the cover — the old blob's `download` then answers
  404.
- The portal's roll-up dedupes to the latest answer per handle, marks the
  guest who changed their mind, and its headcount is the sum of the
  *going* rows' `party`.
- Cancel it: the public page shows it as canceled, the RSVPs stay.
- Delete it: the event, its RSVP rows and its cover blob are all gone —
  check the blob with a direct `blobs/<id>/download` (404) and the rows
  with an `eq: {event_id}` list (empty).
