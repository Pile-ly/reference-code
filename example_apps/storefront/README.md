# Storefront — a small-business website as a Pilely reference app

A copyable, working storefront neoApp — the pattern for **"a website for
my shop / gym / studio"**. The demo business is *Rock Boxing Gym*: a
marketing landing with stacked hero bands, a classes page, a
sign-in-gated inquiry form, and an owner-only inbox. It is a *static*
neoApp — no backend, no tunnel, nothing to keep online — and the leanest
of the reference apps: the whole database is **one table**.

```
storefront/
├── spa/                  the front-end (Vite + React, per the SPA standard)
├── spa_mock/             API-free, in-memory interactive documentation mock
└── build_instruction.md  everything besides UX: registration, database,
                          the empty group + single-table inbox recipe,
                          bundle upload — the exact sequence an agent
                          (or you) follows to ship it
```

## API-free mock

`spa_mock/` is a separate, resettable teaching/demo app. It mirrors the
storefront's static navigation, class-to-inquiry prefill, sign-in-gated and
validated inquiry flow, and paged owner inbox without platform APIs or a
backend. Use it for safely exploring the UX; its fixture state is only held
in browser memory. The production-ready `spa/` remains the real Pilely SPA
and the instructions below apply to it, not to the mock.

### Public gallery build

Build the mock for its public R2 URL with:

```bash
cd spa_mock
VITE_BASE=/reference-code/storefront/ npm run build
```

The public-repository sync publishes the complete bundle; this repository has
no private demo publisher.

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
- **The public-app auth idioms** — sign-in UI gates on
  `window.pilely.user() === null`, never on status codes; the owner-only
  `/admin` link is UI convenience while the empty read group is the real
  protection.
- **Why email is a form field** — the token carries the submitter's
  handle, never their email; the collected address is the follow-up
  channel (the admin inbox is a pure read-only list — no statuses, no
  reply UI).
- **Cursor paging as intended** — `records/list` answers newest-first
  with a cursor; the admin inbox pages with "Load more" instead of
  walking the table.
- **The SPA standard, end to end** — `base: "/"`, no router basepath,
  `_assets`, apex `client.js` + `<meta name="pilely-app">`,
  `public/index.md` as the agent surface, dark + light themes, mobile
  safe-area handling, i18n from day one, the §7b "works from your AI
  client" footer.

## Make it yours

Set `OWNER_HANDLE` and the business content in `spa/src/config.ts`,
mirror the business facts in `spa/public/index.md`, put your registered
`pile_id` in `spa/index.html`, then follow
[build_instruction.md](./build_instruction.md).
