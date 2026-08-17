# Blog — a complete Pilely reference app

A copyable, working blog neoApp: **the owner writes, anyone reads
(signed-in or not), signed-in users comment and like.** It is a *static*
neoApp — no backend, no tunnel, nothing to keep online: the SPA talks
straight to the platform's managed database
([simple_db](https://pilely.app/skill/app_management/simple_db)).

This is the SPA example project that
[build_app/reference](https://pilely.app/skill/build_app/reference) points
at: a finished, standard-conforming answer to "what does a real static-SPA
+ simple_db app look like?"

```
blog/
├── spa/                  the front-end (Vite + React, per the SPA standard)
└── build_instruction.md  everything besides UX: registration, database,
                          tables + access groups, bundle upload — the exact
                          sequence an agent (or you) follows to ship it
```

## What it demonstrates

- **The SPA standard, end to end** — `base: "/"`, no router basepath,
  `_assets`, apex `client.js` + `<meta name="pilely-app">`, `public/index.md`
  as the agent surface, dark + light themes, mobile safe-area handling,
  i18n from day one, the §7b "works from your AI client" footer.
- **The public-app auth idioms** — sign-in UI gates on
  `window.pilely.user() === null`, never on status codes (a public app
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
in `spa/src/config.ts`, put your registered `pile_id` in `spa/index.html`,
then follow [build_instruction.md](./build_instruction.md).
