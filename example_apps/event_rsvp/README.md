# Event RSVP — a two-sided public app as a Pilely reference app

A copyable, working event page — the pattern for **"I host things and
people tell me if they're coming"**. The demo is *Sunset Supper Club*: a
host publishes dinners and picnics that anyone can read (signed in or
not), any signed-in guest RSVPs, and only the host sees who's coming. It
is a *static* neoApp — no backend, nothing to keep online.

```
event_rsvp/
├── spa/                  the front-end (Vite + React, per the SPA standard),
│                         on the @pilely packages; also runs offline in
│                         mock mode
└── build_instruction.md  everything besides UX: registration, database,
                          the empty group + the two-sided table pair, the
                          public-blob contract, bundle upload — the exact
                          sequence an agent (or you) follows to ship it
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
platform services, with the club's sample events on first load. Nothing
leaves the page — the served HTML drops the `client.js` tag and the
`pilely-app` meta. Signed out you are a visitor: the home page, every
event page, and the sign-in gate on the RSVP card. **Login with Pilely**
signs you in as the mock user, whom `.env.mock` names the host
(`VITE_OWNER_HANDLE=mock_user`), so the RSVP form and the whole host
portal — create, edit, cancel, delete, cover uploads, the roll-up — are
reachable. A signed-in guest who is *not* the host cannot be reached in
mock mode: it has exactly one mock user. The sample events carry no
RSVPs (every seeded row would be the mock user's); send some from an event
page and the portal rolls them up. Records persist in the browser's
`localStorage` — clear the site's data to start from the sample content
again — while uploaded covers live in memory only and fall back to the
generative art after a reload.

Under plain `npm run dev` with the committed placeholder pile id, the app
says so instead of rendering a club whose every call would fail.

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
  `read_group: null` + `anon_read: true` (`useUpload` from
  `@pilely/simple-blob`), so signed-out visitors see the cover photos.
  Includes the canvas downscale before upload, presigned links through
  `useBlobUrl`, and replace-a-cover as upload → update → delete-old.
- **Typed simple_db columns** — `integer` and `boolean`, not everything as
  `text`: `starts_at_ms` sorts events and splits upcoming from past, and
  `canceled` is a flag flip that keeps history rather than a delete.
- **Real event time** — one instant plus the host's IANA zone, so a 6:30 pm
  dinner in Oakland reads as 6:30 pm PDT to a guest in Tokyo, and the edit
  form round-trips the host's wall clock from any zone.
- **Client-side cascade deletes** — RSVP rows → the event record → the
  cover blob, as sequential `mutateAsync` calls, records before blobs,
  404s tolerated so a retry converges.
- **The `@pilely` packages** — `<PilelyProvider>` at the root
  (`spa/src/main.tsx`), `usePilelyAuth()` for who is signed in, the
  `@pilely/simple-db` hooks for every read and write (`useRecords` /
  `useRecord` in the components that show the data, optimistic
  `useCreateRecord` / `useUpdateRecord` / `useDeleteRecord`) and the
  `@pilely/simple-blob` hooks for covers; a refused RSVP renders its error
  on the card.
- **The public-app auth idioms** — sign-in UI gates on
  `usePilelyAuth().user === null`, never on a status code (the anonymous
  token means denials are 404s, not 401s); the owner-only "Host portal"
  link is UI convenience while the empty groups are the real protection.
- **The SPA standard, end to end** — `base: "/"`, no router basepath,
  `_assets`, apex `client.js` + `<meta name="pilely-app">`,
  `public/index.md` as the agent surface, dark + light themes, mobile
  safe-area handling, i18n from day one, the §7b "works from your AI
  client" footer.

## Make it yours

Set `OWNER_HANDLE` (its fallback, or `VITE_OWNER_HANDLE` at build time)
and the club's branding in `spa/src/config.ts`, mirror
those facts in `spa/public/index.md`, put your registered `pile_id` in
`spa/index.html`, then follow
[build_instruction.md](./build_instruction.md). The events themselves are
data, not config — you create them in the app once it is live.
