# Build instruction — shipping the storefront

Everything besides the UX (which is already built in `spa/`): how this app
is registered, gets its database, and goes live. Follow top to bottom.
Where a step is a platform atomic, this doc names the skill page and gives
this app's **inputs** — the route manuals stay the contract of record
(GET any route with `?isAgent=1` for its manual), so read the manual at
each step and don't trust example payloads here over what it says.

Prerequisites: a logged-in platform session (JWT) — see
[login](https://pilely.app/skill/account_management/login) — and Node ≥ 20.

## 1. Register the neoApp

Follow [register](https://pilely.app/skill/app_management/register) with
these decisions:

- `serving_mode: "static"` — this app has no backend; the bundle's
  `index.md` is its AI surface. (Permanent choice.)
- `access_mode: "public"` — a storefront exists to be seen: anyone may
  open the app, signed in or not. The marketing pages are bundle content,
  so signed-out visitors need no data access at all — note there is no
  `anon_read` anywhere in this app (the one table is owner-read).
- Path, title, description: yours (e.g. path `rock_gym`, title
  `{"en": "…your business name…"}`).

Registration is metadata-only. **Capture the returned `pile_id`** — the
next step and the table step need it (it is also the `<app_id>` in every
simple_db URL).

## 2. Fill the placeholders

The committed code is a template. Two deployment-specific values, plus
the rebrand:

1. `spa/index.html` — replace `REPLACE_WITH_YOUR_PILE_ID` in
   `<meta name="pilely-app" content="…">` with the real `pile_id`.
   A bundle uploaded with the placeholder has broken sign-in (the mint
   rejects it); nothing else looks wrong until someone tries.
2. `spa/src/config.ts` — set `OWNER_HANDLE` to the owner's handle (no
   `@`). Your session's handle is in the login skill's `/~/me` answer.
3. **The business itself** — `spa/src/config.ts` is the ONE content file:
   brand, every line of landing copy, the class list, the band images
   (static assets under `spa/src/assets/`). Make it your business — and
   mirror the same facts in `spa/public/index.md`, which is the identical
   description for AI agents (a static app's `index.md` is served for
   `GET /?isAgent=1`). The class ids there feed an inquiry's `class`
   field, so the two class lists must not drift.

## 3. Create the app's database

POST `https://simple-db.pilely.app/apps/<pile_id>/create` (owner-only;
empty JSON body). One DB per neoApp — see the
[simple_db manual](https://pilely.app/skill/app_management/simple_db).

## 4. Create the empty group — the "only me" idiom

The inbox must be readable by **nobody but the owner**. simple_db has no
"owner only" literal; the idiom is a group with no members: the owner
always passes every check regardless of groups, so an empty group denies
everyone else.

Create one via [simple_group](https://pilely.app/skill/app_management/simple_group):
POST `https://simple-group.pilely.app/groups/create` (a display name like
`"storefront owner only"` helps future-you). **Capture the returned
22-char group nanoid; add no members, ever.**

## 5. Create the single table — the inbox recipe

POST `https://simple-db.pilely.app/apps/<pile_id>/tables/create` (manual:
that URL with `?isAgent=1`). One table is the whole database:

| table | columns (all `text`) | `read_group` | `write_group` | why |
|---|---|---|---|---|
| `inquiries` | `email`, `question`, `phone`, `class` | the empty group | `null` | anyone signed-in submits; only the owner reads. The submitter's handle and the time come free as `_submitter_handle` / `_created_at_ms` — declare neither. |

```json
{
  "table": "inquiries",
  "columns": [
    {"name": "email", "type": "text"},
    {"name": "question", "type": "text"},
    {"name": "phone", "type": "text"},
    {"name": "class", "type": "text"}
  ],
  "read_group": "<the empty group's nanoid>",
  "write_group": null
}
```

Notes that shape the app (all from the
[simple_db manual](https://pilely.app/skill/app_management/simple_db)):

- **`write_group: null` means every signed-in user** — deliberate, never
  a default. There is no anonymous write of any kind, which is why the
  contact form gates on sign-in.
- **Why `email` is a column at all**: the token carries the submitter's
  **handle**, never their email. A storefront replies by email, so the
  form collects one. (`phone` and `class` are optional at the form and
  stored as `""` when skipped — the app always sends all four fields.)
- **Submitters can never read the inbox back.** The empty read group
  denies their `list`/`get` with the uniform 404 — same bytes as "no such
  table" — so the form's confirmation state is all they ever see. The
  admin page's owner gate is UI convenience; THIS is the protection.
- **No `anon_read`.** The storefront's public content is bundle content;
  the one table is the owner's inbox. Nothing here is anonymously
  readable, and signed-out reads were never needed.
- Records cap at ~16 KB of serialized fields — more than any inquiry
  needs.

**The table is also part of the app's manual.** Alongside the business
facts, `spa/public/index.md` carries the **data surface** the
[SPA standard](https://pilely.app/skill/standards/spa) §7c requires:
`inquiries`, who may read and write it, every column, and the literal
`records/create` / `records/list` calls. A sender has no other way to learn
the field names, so **a table or column change here is a manual change in
the same edit**. `<app_id>` stays a placeholder in the committed file; the
served copy is read from the app the reader is already talking to.

## 6. Build and upload the bundle

```bash
cd spa && npm ci && npm run build
```

Zip the **contents** of `dist/` (not the folder), then follow
[update_bundle](https://pilely.app/skill/app_management/update_bundle) to
upload it — and its required
[source_snapshot](https://pilely.app/skill/app_management/source_snapshot)
step so the server's copy of the source stays current. Re-uploading the
bundle is also the edit path later (static app: no backend to restart) —
rewording the landing page or the class list is a `config.ts` edit, a
rebuild, and a re-upload.

The upload validator enforces what the build already guarantees:
`index.html` + `index.md` at the bundle root, every root folder
`_`-prefixed, root-relative asset URLs.

## 7. Smoke-check the live app

- Open the app's URL signed-out (resolve it via the handle alias
  `https://pile.ly/@<handle>/<path>` → 302): landing, classes, and
  contact all render — that is static bundle content, no data calls at
  all. The contact page shows the sign-in gate, not the form (the SPA
  gates on `window.pilely.user() === null`, never on a status code).
- `GET <app url>/?isAgent=1` returns the bundle's `index.md` — the agent
  surface.
- Sign in as a **non-owner** → the form appears; submit an inquiry (try
  one from a class's Inquire button too — the class arrives pre-filled);
  the confirmation state renders. No admin link appears, and a direct
  `records/list` on `inquiries` as that user answers the uniform 404.
- Sign in as the **owner** → the accent "Inquiries" nav link appears;
  `/admin` lists the submissions newest-first — handle, email, phone,
  class chip, time, question — with "Load more" paging past 50.
