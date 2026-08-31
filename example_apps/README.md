# Example apps

Complete, working Pilely apps. Each one is a **pattern** — a different
answer to "who is allowed to see and do what" — and that is what you are
choosing between. Find your row below, open that project, copy it.

## Which one do I read?

| If you're building… | Read | Services | Shape |
|---|---|---|---|
| Anyone reads it; signed-in people respond | [`blog/`](./blog) | simple_db + simple_group | static SPA |
| Only me, ever — with photos | [`plant_tracker/`](./plant_tracker) | simple_db + simple_blob + simple_group | static SPA |
| A public site with a form only I read | [`storefront/`](./storefront) | simple_db + simple_group | static SPA |
| I publish, the world reads, guests submit privately | [`event_rsvp/`](./event_rsvp) | simple_db + simple_blob + simple_group | static SPA |

Access at a glance — the same four apps, by who can do what:

| App | Anonymous (signed out) | Signed in, not the owner | Owner |
|---|---|---|---|
| `blog` | reads posts, comments, likes | + writes comments, likes | + writes posts; sole reader of drafts |
| `plant_tracker` | nothing (uniform 404) | nothing (uniform 404) | everything |
| `storefront` | reads the marketing pages | + submits an inquiry (write-only) | + sole reader of the inbox |
| `event_rsvp` | reads events + cover photos | + submits an RSVP (write-only) | + publishes events; sole reader of RSVPs |

Every project is self-contained: no shared package, no imports between
them. Duplication here is deliberate — you copy one directory and go.

---

## `blog/` — public read, signed-in response

**Pattern.** The owner publishes; anyone reads, signed in or not;
signed-in visitors comment and like.

**Infrastructure.** Registered `access_mode: "public"`. Static SPA — no
backend, no tunnel, nothing to keep online. Four
[simple_db](https://pilely.app/skill/app_management/simple_db) tables and
one empty
[simple_group](https://pilely.app/skill/app_management/simple_group). No
blobs.

**Access model** (as created in [`build_instruction.md`](./blog/build_instruction.md)):

| table | `read_group` | `anon_read` | `write_group` |
|---|---|---|---|
| `posts` | `null` | `true` | the empty group |
| `drafts` | the empty group | omit | the empty group |
| `comments` | `null` | `true` | `null` |
| `likes` | `null` | `true` | `null` |

**Who can do what.**

- **Anonymous** — reads posts, comments and likes; the `anon_read` opt-in
  on each is what makes a signed-out visitor see anything at all. Writes
  nothing. Never sees `drafts`.
- **Signed in, not the owner** — the same reads, plus writing comments and
  likes: `write_group: null` means *every signed-in user*. They cannot
  edit or delete afterwards — simple_db gives no update or delete to a
  non-owner — so there is no un-like and no comment editing in the UI
  either.
- **Owner** — writes `posts` and `drafts` (the empty write group), and is
  the only reader `drafts` has.

**Copy this when** the world should read your content and signed-in people
should be able to add to it.

**The lesson worth carrying.** Drafts are a **separate table**, never a
`published` flag on `posts`. A table with a shared read exposes every
record it holds; a flag is not an access boundary.

---

## `plant_tracker/` — private, one owner

**Pattern.** One person's data, nobody else's, ever. The counterpart to
`blog/`.

**Infrastructure.** Registered `access_mode: "private"`. Static SPA. Two
[simple_db](https://pilely.app/skill/app_management/simple_db) tables,
[simple_blob](https://pilely.app/skill/app_management/simple_blob) for
photos, one empty
[simple_group](https://pilely.app/skill/app_management/simple_group) used
on every axis of everything.

**Access model** (as created in [`build_instruction.md`](./plant_tracker/build_instruction.md)):

| table | `read_group` | `write_group` | `anon_read` |
|---|---|---|---|
| `plants` | the empty group | the empty group | omit — inert on a private app |
| `waterings` | the empty group | the empty group | omit |

Blobs: every upload carries `read_group` = **that same empty group**.

**Who can do what.**

- **Anonymous** — nothing. On a private app no anonymous credential is
  ever minted, so `anon_read` has nothing to act on, and the app host
  answers a uniform 404: indistinguishable from no app at all.
- **Signed in, not the owner** — also nothing, and for a *second* reason
  that matters. The app-host 404 covers the app; it does **not** cover
  simple_db and simple_blob, which are separate hosts. The empty group on
  both axes of both tables and on every blob is the boundary that actually
  holds.
- **Owner** — everything: both tables, every blob, and client-side cascade
  deletes (records first, then blobs, 404-tolerant so a retry converges).

**Copy this when** the app is for exactly one person and nothing in it is
ever shared.

**The lesson worth carrying.** On a private app the empty group is
load-bearing, not decoration. Registering private is not enough on its
own.

---

## `storefront/` — public site, owner-only inbox

**Pattern.** A website for a shop, gym or studio: static marketing pages
plus one form. The leanest project here — one table is the whole database.

**Infrastructure.** Registered `access_mode: "public"`. Static SPA. One
[simple_db](https://pilely.app/skill/app_management/simple_db) table and
one empty
[simple_group](https://pilely.app/skill/app_management/simple_group). No
blobs, no `anon_read` anywhere.

**Access model** (as created in [`build_instruction.md`](./storefront/build_instruction.md)):

| table | `read_group` | `write_group` |
|---|---|---|
| `inquiries` | the empty group | `null` |

**Who can do what.**

- **Anonymous** — reads every marketing page. That content is *bundle*
  content, not data: the pages make zero data calls, which is why no
  `anon_read` appears anywhere. Cannot submit.
- **Signed in, not the owner** — submits an inquiry (`write_group: null`
  = every signed-in user), and can never read the inbox back, including
  their own row. The denial is the uniform 404.
- **Owner** — the only reader of `inquiries` (empty read group), paged
  newest-first by cursor on an `/admin` page.

**Copy this when** the public part of your app is content you ship in the
bundle, and the only data is something people send you.

**The lesson worth carrying.** The `/admin` link is UI convenience; the
empty read group is the protection. And email is a form field, because the
token carries the submitter's handle, never their email.

---

## `event_rsvp/` — two-sided: public reads, private writes

**Pattern.** The owner publishes to the world; signed-in visitors send
something back that only the owner sees.

**Infrastructure.** Registered `access_mode: "public"`. Static SPA. Two
[simple_db](https://pilely.app/skill/app_management/simple_db) tables that
are mirror images of each other,
[simple_blob](https://pilely.app/skill/app_management/simple_blob) for
public cover photos, one empty
[simple_group](https://pilely.app/skill/app_management/simple_group) used
on opposite axes of the two tables.

**Access model** (as created in [`build_instruction.md`](./event_rsvp/build_instruction.md)):

| table | `read_group` | `anon_read` | `write_group` |
|---|---|---|---|
| `events` | `null` | `true` | the empty group |
| `rsvps` | the empty group | omit | `null` |

Blobs: every cover upload carries `read_group: null` + `anon_read: true` —
the **public** blob contract, so signed-out visitors see the photos.

**Who can do what.**

- **Anonymous** — reads events and their cover photos. This is the project
  to read for `anon_read` on *blobs*, not just tables. Anonymous rows come
  back one field short: no `_submitter_user_id` (`_submitter_handle` stays).
- **Signed in, not the owner** — the same reads, plus writing an RSVP.
  Cannot read it back, ever. Changing an answer means **sending another
  row**; the app shows the guest a `localStorage` memo that says out loud
  it is per-device.
- **Owner** — publishes, edits and cancels events (cancel is a `boolean`
  flip, not a delete, so history survives), uploads covers, and is the
  only reader of `rsvps`; the host portal dedupes to the latest row per
  `_submitter_handle`.

**Copy this when** you publish something public and collect private
replies about it.

**The lesson worth carrying.** Copy the *reasoning*, not just the code: the
temptation is to show a guest their "current RSVP" as if the server told
you. It cannot. Also the only project here using typed columns —
`integer` and `boolean`, not everything as `text`.

---

## What is not here yet

- **No backend example.** All four are static SPAs. If your app needs a
  server — a tunnel adapter, forwarded identity, a `GET`-manual /
  `POST`-act surface — read the
  [backend standard](https://pilely.app/skill/standards/backend); there is
  no reference project for it in this folder.
- **No `simple_email` or `simple_payment` example.** Their service manuals
  are complete on their own.
- If no pattern above matches yours, the
  [SPA standard](https://pilely.app/skill/standards/spa) and the backend
  standard are enough to build from directly. Don't force your app into
  the nearest project.

## Also worth reading

- [`../reusable_components/sign_in_button/`](../reusable_components/sign_in_button) — the **"Login with Pilely"**
  affordance on its own. Every project here ships its own copy of that
  behavior; that folder is the behavior alone, with the rules a
  hand-rolled sign-in gate usually gets wrong.

## Before you ship a copy

Each project's own `README.md` lists the placeholders to fill (owner
handle, `pile_id`, and for `plant_tracker` the group nanoid), and its
`build_instruction.md` is the server-side sequence — registration,
groups, tables, the blob contract, bundle upload — in the order to do it.
