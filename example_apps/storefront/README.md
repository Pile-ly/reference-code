# Storefront — a small-business website as a Pilely reference app

A copyable, working storefront neoApp — the pattern for **"a website for
my shop / gym / studio"**. The demo business is *Rock Boxing Gym*: a
marketing landing with stacked hero bands, a classes page, a
sign-in-gated inquiry form, and an owner-only inbox. It is a *static*
neoApp — no backend, nothing to keep online — and the leanest
of the reference apps: the whole database is **one table**.

```
storefront/
├── spa/                  the front-end (Vite + React, per the SPA standard),
│                         on the @pilely packages; also runs offline in
│                         mock mode
└── build_instruction.md  everything besides UX: registration, database,
                          the empty group + single-table inbox recipe,
                          bundle upload — the exact sequence an agent
                          (or you) follows to ship it
```

`spa/` is the app — the one you run, configure and ship.
`build_instruction.md` is the platform setup around it; the hooks never
create anything, so the database, the empty group and the table there are
setup steps.

## Run it

```bash
cd spa
npm install
npm run dev        # the real runtime: needs a registered pile id (see below)
npm run dev:mock   # mock mode: no registration, no network
```

`npm run dev:mock` runs the same app against in-browser fakes of the
platform services, with a sample inbox of inquiries — more than one
50-row page, so "Load more" has something to load. Nothing leaves the
page — the served HTML drops the `client.js` tag and the `pilely-app`
meta. Signed out you are a visitor: landing, classes, and the contact
page's sign-in gate. **Login with Pilely** signs you in as the mock user,
whom `.env.mock` names the owner (`VITE_OWNER_HANDLE=mock_user`), so the
inquiry form, the Inquiries link and the `/admin` inbox are all
reachable. A signed-in visitor who is *not* the owner cannot be reached
in mock mode: it has exactly one mock user. Every seeded inquiry shows
the mock user's handle, since the fake records whoever is signed in as
the submitter. Changes persist in the browser's `localStorage`; clear the
site's data to start from the sample content again.

Under plain `npm run dev` with the committed placeholder pile id, the app
says so instead of rendering a storefront whose inquiry form could never
send.

## What it demonstrates

- **Fully static marketing content** — every word of copy, the class
  list, and the hero images live in ONE file (`spa/src/config.ts`, images
  as imported static assets). Rebranding the gym into any other business
  is an edit to that file (plus its agent-facing mirror,
  `spa/public/index.md`) — no CMS tables, no blobs, and the marketing
  pages make zero data calls.
- **The simple_db inbox recipe** — `inquiries` with `write_group: null`
  (any signed-in user submits) and `read_group` = an **empty group** (the
  "only me" idiom: only the owner reads). Submitters can never read the
  inbox back; every denial is the uniform 404.
- **The `@pilely` packages** — `<PilelyProvider>` at the root
  (`spa/src/main.tsx`), `usePilelyAuth()` for who is signed in, and the
  `@pilely/simple-db` hooks for the data: `useRecords` for the owner's
  inbox, `useCreateRecord` for the inquiry form — not optimistic, since
  the submitter can never read the row back — with a refused create's
  error rendered under the form.
- **The public-app auth idioms** — sign-in UI gates on
  `usePilelyAuth().user === null`, never on status codes; the owner-only
  `/admin` link is UI convenience while the empty read group is the real
  protection.
- **Why email is a form field** — the token carries the submitter's
  handle, never their email; the collected address is the follow-up
  channel (the admin inbox is a pure read-only list — no statuses, no
  reply UI).
- **Cursor paging as intended** — `records/list` answers newest-first
  with a cursor; the admin inbox is `useRecords` at 50 a page, with
  "Load more" on `hasNextPage` / `fetchNextPage` instead of walking the
  table.
- **The SPA standard, end to end** — `base: "/"`, no router basepath,
  `_assets`, apex `client.js` + `<meta name="pilely-app">`,
  `public/index.md` as the agent surface, dark + light themes, mobile
  safe-area handling, i18n from day one, the §7b "works from your AI
  client" footer.

## Make it yours

Set `OWNER_HANDLE` (its fallback, or `VITE_OWNER_HANDLE` at build time)
and the business content in `spa/src/config.ts`,
mirror the business facts in `spa/public/index.md`, put your registered
`pile_id` in `spa/index.html`, then follow
[build_instruction.md](./build_instruction.md).
