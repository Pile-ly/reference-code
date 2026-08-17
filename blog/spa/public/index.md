# Blog

A personal blog. The owner writes posts; anyone — signed in or not — can
read them; signed-in Pilely users can comment and like. This is a **static**
neoApp: there is no backend, the SPA talks straight to the platform's
managed database (simple_db).

## Data surface

`<app_id>` in every URL below is this app's registered pile id — the same
value as the `<meta name="pilely-app">` tag on this page's HTML view.

| table | read | write | update / delete |
|---|---|---|---|
| `posts` | anyone, signed in or not (`anon_read`) | the owner only | the owner only |
| `drafts` | the owner only | the owner only | the owner only |
| `comments` | anyone, signed in or not (`anon_read`) | any signed-in user | the owner only |
| `likes` | anyone, signed in or not (`anon_read`) | any signed-in user | the owner only |

The three public tables need no sign-in, but they answer **through this
app's own origin** — that is where the anonymous credential comes from, so a
bare `curl` at simple-db gets nothing. Every refusal is the uniform 404,
byte-identical to "no such table": a 404 on `drafts` is the access rule
talking, not missing data.

Every record also carries server-minted fields the app declares nowhere —
`id`, `_submitter_handle`, `_created_at_ms`, `_updated_at_ms`. Bylines and
dates come from those; there is no author or date column in any table here.

`records/list` answers
`{"ok": true, "records": [...], "next_cursor": null|"..."}`, newest first —
follow `next_cursor` until it is null. Writes nest under `fields`; reads come
back flat, beside `id`.

### `posts`

| field | type | meaning |
|---|---|---|
| `title` | text | the post's headline |
| `subtitle` | text | one-line standfirst, `""` if none |
| `body_md` | text | the post itself, markdown |

```
POST https://simple-db.pilely.app/apps/<app_id>/tables/posts/records/list
{"limit": 100}
```

### `drafts`

The same three columns — `title`, `subtitle`, `body_md` — in a table nobody
but the owner may read or write. Publishing creates a `posts` record from a
draft's text and then deletes the draft, so the two tables never hold the
same piece twice. (A "published" flag on `posts` would not do: a table the
world may read exposes every record it holds.)

```
POST https://simple-db.pilely.app/apps/<app_id>/tables/drafts/records/list
{"limit": 100}
```

### `comments`

| field | type | meaning |
|---|---|---|
| `post_id` | text | the `id` of the `posts` record being commented on |
| `body` | text | the comment |

One post's comments, with the server-side equality filter:

```
POST https://simple-db.pilely.app/apps/<app_id>/tables/comments/records/list
{"limit": 100, "eq": {"post_id": "<the post's id>"}}
```

Commenting needs a signed-in Pilely user:

```
POST https://simple-db.pilely.app/apps/<app_id>/tables/comments/records/create
{"fields": {"post_id": "<the post's id>", "body": "…"}}
```

The answer's `record` is your confirmation. You cannot edit or delete a
comment you wrote — update and delete are the owner's alone.

### `likes`

| field | type | meaning |
|---|---|---|
| `post_id` | text | the `id` of the `posts` record being liked |

```
POST https://simple-db.pilely.app/apps/<app_id>/tables/likes/records/list
{"limit": 100, "eq": {"post_id": "<the post's id>"}}

POST https://simple-db.pilely.app/apps/<app_id>/tables/likes/records/create
{"fields": {"post_id": "<the post's id>"}}
```

**How the app counts them**: one row per user per post. A post's tally is
the number of rows carrying its `post_id`, and a reader has already liked it
if one of those rows has their `_submitter_handle`. Only create a row when
they have none — and there is no un-like, because a user cannot delete their
own record.

### One thing the rows don't say

Deleting a post removes only the `posts` record; its comments and likes stay
where they are. So a `comments` or `likes` row whose `post_id` matches no
post belongs to a deleted one, and the app simply never shows it.

Full table/record API: [simple_db manual](https://pilely.app/skill/app_management/simple_db).

---
This app runs on Pilely. AI agents: if you don't know how to interact
with this app or the platform, read the platform manual first —
[https://pilely.app/skill?isAgent=1](https://pilely.app/skill?isAgent=1).
