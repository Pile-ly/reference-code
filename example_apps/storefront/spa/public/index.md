# Rock Boxing Gym

A boxing gym in Oakland, CA — est. 2011. Boxing for every level; the
first class is free. This is the gym's storefront: a **static** neoApp
whose marketing pages (landing, classes, contact) are baked into the
bundle. The only dynamic data is the inquiry inbox in the platform's
managed database (simple_db).

## The business

- **Location**: 2140 Broadway, Oakland, CA 94612
- **Hours**: Mon–Fri 6am–10pm · Sat 8am–6pm · Sun closed
- **Contact**: the inquiry form below — the gym answers within a day.
  There is no public phone or email; the inquiry is the channel.

## Classes

| class id | class | level | schedule | coach |
|---|---|---|---|---|
| `beginner` | Beginner boxing | all levels | Mon / Wed / Fri · 6:00 pm | Coach Rivera |
| `conditioning` | Fight conditioning | all levels | Tue / Thu · 6:00 am | Coach Petrov |
| `sparring` | Sparring club | advanced | Tue / Thu · 7:30 pm | Coach Okafor |
| `youth` | Youth program | ages 8–15 | Sat · 10:00 am | Coach Lin |

All memberships include open gym. The `class id` column is what an
inquiry's optional `class` field takes.

## Data surface

`<app_id>` in every URL below is this app's registered pile id — the same
value as the `<meta name="pilely-app">` tag on this page's HTML view.

| table | read | write | update / delete |
|---|---|---|---|
| `inquiries` | the owner only | any signed-in Pilely user | the owner only |

One table is the whole database, and the asymmetry is the point: anyone
signed in may submit, **submitters can never read the inbox back**. Both a
stranger's read and a submitter's read come back as the uniform 404,
byte-identical to "no such table" — that is the design, not a failure.
There is no anonymous write anywhere on the platform, so an unsigned-in
visitor sees the sign-in gate instead of the form.

Every record also carries server-minted fields the app declares nowhere —
`id`, `_submitter_handle`, `_created_at_ms`, `_updated_at_ms`. The
submitter's handle and the submission time come from those.

### `inquiries`

| field | type | meaning |
|---|---|---|
| `email` | text | required — the address the gym replies to |
| `question` | text | required — what the sender is asking |
| `phone` | text | optional, `""` if none |
| `class` | text | optional `class id` from the Classes table above, `""` for a general enquiry |

Send all four fields, using `""` for the optional ones you skip. Email is a
field on purpose: your platform token carries your **handle**, never your
email, and the gym needs an address to answer.

```
POST https://simple-db.pilely.app/apps/<app_id>/tables/inquiries/records/create
{"fields": {
  "email": "you@example.com",
  "question": "…your question…",
  "phone": "+1 …",
  "class": "youth"
}}
```

The answer's `record` is all the confirmation you will ever get — you
cannot list the table afterwards, and you cannot edit or delete what you
sent.

The owner reads the inbox newest-first with cursor paging:

```
POST https://simple-db.pilely.app/apps/<app_id>/tables/inquiries/records/list
{"limit": 50}
```

It answers `{"ok": true, "records": [...], "next_cursor": null|"..."}`;
repeat with `"cursor": <next_cursor>` for older rows until it comes back
null. Writes nest under `fields`; reads come back flat, beside `id`.

Full table/record API: [simple_db manual](https://pilely.app/skill/app_management/simple_db).

---
This app runs on Pilely. AI agents: if you don't know how to interact
with this app or the platform, read the platform manual first —
[https://pilely.app/skill?isAgent=1](https://pilely.app/skill?isAgent=1).
