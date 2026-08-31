# Event RSVP — a two-sided public app as a Pilely reference app

A copyable, working event page — the pattern for **"I host things and
people tell me if they're coming"**. The demo is *Sunset Supper Club*: a
host publishes dinners and picnics that anyone can read (signed in or
not), any signed-in guest RSVPs, and only the host sees who's coming. It
is a *static* neoApp — no backend, no tunnel, nothing to keep online.

```
event_rsvp/
├── spa/                  the front-end (Vite + React, per the SPA standard)
├── spa_mock/             API-free, resettable interactive guest/host demo;
│                         documentation and local exploration only
└── build_instruction.md  everything besides UX: registration, database,
                          the empty group + the two-sided table pair, the
                          public-blob contract, bundle upload — the exact
                          sequence an agent (or you) follows to ship it
```

## Choose the right app

`spa/` is the deployable reference application. It uses Pilely authentication,
simple_db, and simple_blob; follow the build instruction when you are making a
real club. `spa_mock/` is a separate, in-memory companion for trying the same
guest RSVP, host roll-up, and event-management interactions without any API
calls, credentials, or persistent data. It is not a replacement build for the
deployable SPA.

## What it demonstrates

- **The two-sided pattern** — two tables that are mirror images of each
  other, sharing one empty group on opposite axes:

  | table | read | write |
  |---|---|---|
  | `events` | everyone, **signed out included** (`read_group: null` + `anon_read: true`) | the host only (empty write group) |
  | `rsvps` | the host only (empty read group) | any signed-in user (`write_group: null`) |

- **The one-way postcard, handled honestly** — a guest can write an RSVP
  and can never read it back (uniform 404), and simple_db lets nobody but
  the owner update a record. So "change your RSVP" is *sending another
  row*, the host portal dedupes to the latest per `_submitter_handle` and
  marks who changed their mind, and the guest's own screen shows a
  `localStorage` memo that says out loud it is per-device. Copy this
  reasoning, not just the code: the temptation is to show a guest their
  "current RSVP" as if the server told you.
- **Public blobs** — the first reference app to upload with
  `read_group: null` + `anon_read: true`, so signed-out visitors see the
  cover photos. Includes the multipart text-field form of those flags, the
  canvas downscale before upload, per-render presigned links, and
  replace-a-cover as upload → update → delete-old.
- **Typed simple_db columns** — `integer` and `boolean`, not everything as
  `text`: `starts_at_ms` sorts events and splits upcoming from past, and
  `canceled` is a flag flip that keeps history rather than a delete.
- **Real event time** — one instant plus the host's IANA zone, so a 6:30 pm
  dinner in Oakland reads as 6:30 pm PDT to a guest in Tokyo, and the edit
  form round-trips the host's wall clock from any zone.
- **Client-side cascade deletes** — RSVP rows → the event record → the
  cover blob, records before blobs, 404s tolerated so a retry converges.
- **The public-app auth idioms** — sign-in UI gates on
  `window.pilely.user() === null`, never on a status code (the anonymous
  token means denials are 404s, not 401s); the owner-only "Host portal"
  link is UI convenience while the empty groups are the real protection.
- **The SPA standard, end to end** — `base: "/"`, no router basepath,
  `_assets`, apex `client.js` + `<meta name="pilely-app">`,
  `public/index.md` as the agent surface, dark + light themes, mobile
  safe-area handling, i18n from day one, the §7b "works from your AI
  client" footer.

## Make it yours

Set `OWNER_HANDLE` and the club's branding in `spa/src/config.ts`, mirror
those facts in `spa/public/index.md`, put your registered `pile_id` in
`spa/index.html`, then follow
[build_instruction.md](./build_instruction.md). The events themselves are
data, not config — you create them in the app once it is live.
