# Blog — a complete Pilely reference app

A copyable, working blog neoApp: **the owner writes, anyone reads
(signed-in or not), signed-in users comment and like.** It is a *static*
neoApp — no backend, nothing to keep online: the SPA talks
straight to the platform's managed database
([simple_db](https://pilely.app/skill/app_management/simple_db)).

This is the SPA example project that
[build_app/reference](https://pilely.app/skill/build_app/reference) points
at: a finished, standard-conforming answer to "what does a real static-SPA
+ simple_db app look like?"

```
blog/
├── spa/                  the front-end (Vite + React, per the SPA standard),
│                         on the @pilely packages; also runs offline in
│                         mock mode
└── build_instruction.md  everything besides UX: registration, database,
                          tables + access groups, bundle upload — the exact
                          sequence an agent (or you) follows to ship it
```

`spa/` is the app — the one you run, configure and ship.
`build_instruction.md` is the platform setup around it; the hooks never
create anything, so every table and group there is a setup step.

## Run it

```bash
cd spa
npm install
npm run dev        # the real runtime: needs a registered pile id (see below)
npm run dev:mock   # mock mode: no registration, no network
```

`npm run dev:mock` runs the same app against in-browser fakes of the
platform services, with sample posts and a private draft on first load.
Nothing leaves the page — the served HTML drops the `client.js` tag and the
`pilely-app` meta. Signed out you are a visitor; **Login with Pilely**
signs you in as the mock user, whom `.env.mock` names the owner
(`VITE_OWNER_HANDLE=mock_user`), so the drafts, the editor, edit/delete and
comment moderation are all reachable. A signed-in reader who is *not* the
owner cannot be reached in mock mode: it has exactly one mock user.
Changes persist in the browser's `localStorage`; clear the site's data to
start from the sample content again.

Under plain `npm run dev` with the committed placeholder pile id, the app
says so instead of rendering a blog whose every call would fail.

## What it demonstrates

- **The SPA standard, end to end** — `base: "/"`, no router basepath,
  `_assets`, apex `client.js` + `<meta name="pilely-app">`, `public/index.md`
  as the agent surface, dark + light themes, mobile safe-area handling,
  i18n from day one, the §7b "works from your AI client" footer.
- **The `@pilely` packages** — `<PilelyProvider>` at the root
  (`spa/src/main.tsx`), `usePilelyAuth()` for who is signed in, and the
  `@pilely/simple-db` hooks for every read and write: `useRecords` /
  `useRecord` in the components that show the data, optimistic
  `useCreateRecord` / `useUpdateRecord` / `useDeleteRecord` for writes, a
  refused write's error rendered where it happened.
- **The public-app auth idioms** — sign-in UI gates on
  `usePilelyAuth().user === null`, never on status codes (a public app
  holds an anonymous token; every denial is a uniform 404); the button is
  the platform-wide **"Login with Pilely"**.
- **simple_db access design** — four tables, four access shapes:
  world-readable owner-written (`posts`), owner-only via the empty-group
  idiom (`drafts`), world-readable anyone-writes (`comments`, `likes`).
- **Platform-honest UX** — bylines/dates come from server-minted fields;
  there is no un-like and no comment self-editing because users cannot
  update or delete records, and the UI never pretends otherwise.

## Make it yours

Two placeholders, one build: set `OWNER_HANDLE` (and the masthead strings)
in `spa/src/config.ts` — its fallback, or `VITE_OWNER_HANDLE` at build
time — put your registered `pile_id` in `spa/index.html`, then follow
[build_instruction.md](./build_instruction.md).
