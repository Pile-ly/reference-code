# Sunset Supper Club

Occasional dinners and picnics, hosted by one person. This page is the
app's agent surface: what the club is, and how to read the events, send an
RSVP, or (as the host) read the answers — all through the platform's
managed database, [simple_db](https://pilely.app/skill/app_management/simple_db).

It is a **static** neoApp — no backend. Everything below is a direct call
to simple_db or [simple_blob](https://pilely.app/skill/app_management/simple_blob)
with your own token; there is no app-specific API to learn.

## Data surface

`<app_id>` in every URL below is this app's registered pile id — the same
value as the `<meta name="pilely-app">` tag on this page's HTML view.

| table | read | write | update / delete |
|---|---|---|---|
| `events` | anyone, signed in or not (`anon_read`) | the host only | the host only |
| `rsvps` | the host only | any signed-in user | the host only |

That asymmetry is the whole app. Two consequences worth reading twice:

- **An RSVP is one-way.** You can create a row in `rsvps`; you can never
  read the table back, and you cannot update or delete the row you wrote.
  Both come back as the uniform 404 — byte-identical to "no such table".
  That is the design, not a failure.
- **Changing your answer means sending another row.** The host's portal
  keeps the LATEST row per `_submitter_handle` and marks anyone who sent
  more than one as "changed". So: send again, don't try to edit.

Every record also carries the server-minted `id`, `_submitter_handle` and
`_created_at_ms`, which the app declares nowhere and never sends.
`records/list` answers
`{"ok": true, "records": [...], "next_cursor": null|"..."}`, newest first —
follow `next_cursor` for older pages. Writes nest under `fields`; reads
come back flat, beside `id`.

### `events`

| field | type | meaning |
|---|---|---|
| `title` | text | |
| `starts_at_ms` | integer | start time, epoch milliseconds |
| `tz` | text | IANA zone the host created it in — **format `starts_at_ms` in THIS zone**, not the reader's |
| `place` | text | may be `""` |
| `description` | text | may be `""` |
| `cover_blob_id` | text | simple_blob nanoid of the cover photo, `""` if none |
| `canceled` | boolean | `true` = called off; the record and its RSVPs are kept |

Reading them needs no sign-in **in a browser**: the page's platform client
holds an anonymous credential for signed-out visitors. Calling simple-db
directly, you still need a token minted for THIS app — a request with no
`Authorization` header is `401 login_required`, not a read. The `id` here is
the `<event_id>` an RSVP carries, and the `/event/<id>` page:

```
POST https://simple-db.pilely.app/apps/<app_id>/tables/events/records/list
{"limit": 100}
```

There is no "past" flag: an event is past when `starts_at_ms` is more than
three hours ago — the same grace window the web UI uses, so an event that
is under way still reads as upcoming.

Creating, editing and cancelling are ordinary host writes:

```
POST https://simple-db.pilely.app/apps/<app_id>/tables/events/records/create
{"fields": {"title": "Rooftop dinner no. 13", "starts_at_ms": 1787452200000,
            "tz": "America/Los_Angeles", "place": "The Annex rooftop",
            "description": "…", "cover_blob_id": "", "canceled": false}}

POST https://simple-db.pilely.app/apps/<app_id>/tables/events/records/<id>/update
{"fields": {"canceled": true}}
```

**Cancel is not delete.** Flipping `canceled` keeps the event and its
RSVPs and shows it publicly as called off. Deleting is a cascade the
caller performs: delete that event's `rsvps` rows, then the event record,
then its cover blob. Nothing cascades on its own, and none of it can be
undone.

### `rsvps`

| field | type | meaning |
|---|---|---|
| `event_id` | text | the `id` of the `events` record being answered |
| `status` | text | `"going"` or `"cant"` |
| `party` | integer | heads including you; ALWAYS `0` when status is `"cant"` |
| `note` | text | may be `""` |

Any signed-in Pilely user may send one — all four fields, every time:

```
POST https://simple-db.pilely.app/apps/<app_id>/tables/rsvps/records/create
{"fields": {
  "event_id": "<the event's id>",
  "status": "going",
  "party": 2,
  "note": "bringing bread"
}}
```

Your handle and the time are recorded automatically — don't send them. The
answer's `record` is the only confirmation you will ever get: you cannot
list the table afterwards. There is **no anonymous RSVP**; the web UI shows
a "Login with Pilely" button rather than a form when nobody is signed in.

The host reads the answers, filtering server-side:

```
POST https://simple-db.pilely.app/apps/<app_id>/tables/rsvps/records/list
{"limit": 100, "eq": {"event_id": "<the event's id>"}}
```

Drop the `eq` to walk every RSVP for every event. Anyone who is not the
host gets the uniform 404 from this call, whatever their token says.

**How the host's portal rolls the rows up** — the raw table doesn't say any
of this, and an agent that skips it will report different numbers from the
app's own screens:

1. Sort newest first by `_created_at_ms`.
2. Keep the FIRST row per `_submitter_handle` — that is their current
   answer; the older ones are superseded.
3. A handle with more than one row **changed their mind** at some point.
4. `going` = kept rows with `status: "going"`; **headcount** = the sum of
   their `party`; `can't` = the kept rows with `status: "cant"`.

### Cover photos

Records hold blob ids, never URLs. Ask for a fresh short-lived link when
you actually want the bytes, and don't store it:

```
POST https://simple-blob.pilely.app/blobs/<cover_blob_id>/download
{}
```

The covers are marked `anon_read`, so this works for a signed-out visitor
too — but only under a token belonging to this app, which is what the
browser client holds and what an agent mints. Tokenless, it is the same
`401`.

---
This app runs on Pilely. AI agents: if you don't know how to interact
with this app or the platform, read the platform manual first —
[https://pilely.app/skill?isAgent=1](https://pilely.app/skill?isAgent=1).
