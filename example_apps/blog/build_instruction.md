# Build instruction — shipping the blog

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
- `access_mode: "public"` — anyone may open the app. This is also the
  precondition for `anon_read` below: on a non-public app, signed-out
  visitors could never read the feed.
- Path, title, description: yours (e.g. path `blog`, title `{"en": "…your
  blog's name…"}`).

Registration is metadata-only. **Capture the returned `pile_id`** — the
next step and both table steps need it (it is also the `<app_id>` in every
simple_db URL).

## 2. Fill the two placeholders

The committed code is a template with exactly two deployment-specific
values:

1. `spa/index.html` — replace `REPLACE_WITH_YOUR_PILE_ID` in
   `<meta name="pilely-app" content="…">` with the real `pile_id`.
   A bundle uploaded with the placeholder has broken sign-in (the mint
   rejects it); nothing else looks wrong until someone tries.
2. `spa/src/config.ts` — set `OWNER_HANDLE` to the owner's handle (no
   `@`). Your session's handle is in the login skill's `/~/me` answer.
   While there, make `BLOG_TITLE` / `BLOG_TAGLINE` yours.

## 3. Create the app's database

POST `https://simple-db.pilely.app/apps/<pile_id>/create` (owner-only;
empty JSON body). One DB per neoApp — see the
[simple_db manual](https://pilely.app/skill/app_management/simple_db).

## 4. Create the empty group — the "only me" idiom

Drafts must be readable and writable by **nobody but the owner**. simple_db
has no "owner only" literal; the idiom is a group with no members: the
owner always passes every check regardless of groups, so an empty group
denies everyone else.

Create one via [simple_group](https://pilely.app/skill/app_management/simple_group):
POST `https://simple-group.pilely.app/groups/create` (a display name like
`"blog owner only"` helps future-you). **Capture the returned 22-char group
nanoid; add no members, ever.**

## 5. Create the four tables

POST `https://simple-db.pilely.app/apps/<pile_id>/tables/create` once per
table (manual: that URL with `?isAgent=1`). The access design is the heart
of this app:

| table | columns (all `text`) | `read_group` | `anon_read` | `write_group` | why |
|---|---|---|---|---|---|
| `posts` | `title`, `subtitle`, `body_md` | `null` | `true` | the empty group | the world reads (signed-out included); only the owner writes |
| `drafts` | `title`, `subtitle`, `body_md` | the empty group | omit | the empty group | owner-only. NEVER a flag on `posts`: a shared-read table exposes every record it holds |
| `comments` | `post_id`, `body` | `null` | `true` | `null` | the world reads; any signed-in user comments |
| `likes` | `post_id` | `null` | `true` | `null` | anon-readable counts; any signed-in user likes |

Example — `posts` (the others differ only per the table above):

```json
{
  "table": "posts",
  "columns": [
    {"name": "title", "type": "text"},
    {"name": "subtitle", "type": "text"},
    {"name": "body_md", "type": "text"}
  ],
  "read_group": null,
  "write_group": "<the empty group's nanoid>",
  "anon_read": true
}
```

Notes that shape the app (all from the
[simple_db manual](https://pilely.app/skill/app_management/simple_db)):

- Bylines and dates are free — every record carries server-minted
  `_submitter_handle` / `_created_at_ms`; the app declares no author or
  date columns.
- **Update/delete is the owner's alone.** That is why commenters can't
  edit or remove their comments, and why there is no un-like — the UI is
  honest about both.
- **Every denial is a uniform 404.** The SPA never infers "signed out"
  or "missing" from a 404; sign-in UI gates on `window.pilely.user()`.
- Records cap at ~16 KB of serialized fields — that bounds a post's size
  (the editor surfaces this).

**This table set is also the app's manual.** `spa/public/index.md` — the
markdown served for `GET /?isAgent=1` — carries the **data surface** the
[SPA standard](https://pilely.app/skill/standards/spa) §7c requires: all
four tables, who may read and write each, every column, and the literal
`records/list` / `records/create` calls. It is the only place an agent can
learn any of that, so **a table or column change here is a manual change in
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
bundle is also the edit path later (static app: no backend to restart).

The upload validator enforces what the build already guarantees:
`index.html` + `index.md` at the bundle root, every root folder
`_`-prefixed, root-relative asset URLs.

## 7. Smoke-check the live app

- Open the app's URL signed-out (resolve it via the handle alias
  `https://pile.ly/@<handle>/<path>` → 302): the feed renders — that is
  `anon_read` working through the app's own origin. (It works only
  there: the anonymous credential is minted by the app page, so a bare
  `curl` on the tables gets a 401 — that's expected, not a failure.)
- `GET <app url>/?isAgent=1` returns the bundle's `index.md` — the agent
  surface.
- "Login with Pilely" → sign in → commenting and liking work; the owner
  account additionally sees Drafts / New post and can publish, edit,
  delete, and remove comments.
