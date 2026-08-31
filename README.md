# Pilely reference code

> **Read-only mirror.** This repository is synced automatically from an
> internal monorepo. Pull requests are not accepted and will be closed;
> history is rewritten on every sync (each publish is a single squashed
> commit).

Complete, working reference apps for [pilely.app](https://pilely.app).
Copy the one closest to what you're building and adapt it — don't
re-derive the setup from scratch.

Clone the repo, or grab the
[source zip](https://github.com/Pile-ly/reference-code/archive/refs/heads/main.zip)
and take just the directory you need. Every project is self-contained.

## Example apps

**Start at [`example_apps/README.md`](./example_apps).** It is the index:
a chooser table, and for each app the services it uses, its simple_db
access model, and exactly what an anonymous visitor, a signed-in user and
the owner can each do. Pick from there rather than guessing from the names.

- **[`example_apps/blog/`](./example_apps/blog)** — public read, signed-in
  response. The owner writes; anyone reads, signed in or not; signed-in
  users comment and like. On the managed database
  ([simple_db](https://pilely.app/skill/app_management/simple_db)).
- **[`example_apps/plant_tracker/`](./example_apps/plant_tracker)** —
  private, one owner. `access_mode: "private"`, the empty-group "only me"
  idiom on every table and blob, and the camera → downscale → upload photo
  pipeline. simple_db +
  [simple_blob](https://pilely.app/skill/app_management/simple_blob).
- **[`example_apps/storefront/`](./example_apps/storefront)** — a public
  site with an owner-only inbox. Static marketing pages whose content
  lives in one config file, plus the simple_db inbox recipe. The leanest
  project here: one table is the whole database.
- **[`example_apps/event_rsvp/`](./example_apps/event_rsvp)** — two-sided.
  The host publishes events **anyone reads, signed in or not**; any
  signed-in guest sends an RSVP only the host can read. The project to
  read for `anon_read` on blobs and for typed simple_db columns.

Each app ships a `build_instruction.md` — the whole server side in order:
registration → groups → tables → the blob contract → bundle upload — and a
`README.md` listing the placeholders to fill.

More apps land here as they're written. If none matches your pattern, the
standards below are complete on their own and are enough to build against.

## Client packages

These are installed, not copied — the opposite of everything else in this
repository. **Start at [`npm/`](./npm)**, the index of the whole workspace.
Nothing here is on the registry yet; install with the scope once it is, so
the name that gets copy-pasted is always the one this project owns.

- **`@pilely/core`** — the typed facade over the platform's `client.js`
  runtime.
- **`@pilely/simple-db`** — wraps the managed database
  ([simple_db](https://pilely.app/skill/app_management/simple_db)).
- **`@pilely/simple-blob`** — wraps managed file storage
  ([simple_blob](https://pilely.app/skill/app_management/simple_blob)).
- **`@pilely/simple-group`** — wraps managed group membership and
  permissions ([simple_group](https://pilely.app/skill/app_management/simple_group)).
- **`@pilely/simple-email`** — wraps managed transactional email
  ([simple_email](https://pilely.app/skill/app_management/simple_email)).

## Reusable components

Not patterns to build from — pieces an app **reuses as-is**. See
[`reusable_components/README.md`](./reusable_components).

- **[`reusable_components/sign_in_button/`](./reusable_components/sign_in_button)**
  — the **"Login with Pilely"** affordance on its own. Every Pilely app
  labels sign-in with that one name, because a visitor should recognize it
  and know their password is only ever typed on the platform, never into an
  app. A dependency-free React component, the reference CSS, and a static
  [`preview.html`](./reusable_components/sign_in_button/preview.html) you
  can open to see it in both themes. It also carries the two rules a
  hand-rolled gate usually gets wrong: wait for `window.pilely.ready` before
  deciding who is there, and gate on `user() === null` — never on a 401,
  which a public app's anonymous token means you'll never see.

- **[`reusable_components/ux_picker_template/`](./reusable_components/ux_picker_template)**
  — the **look picker**: the page an agent shows a user to ask which look
  they want. A Vite project that shows the app's screens as devices on a
  rail and re-skins them through four named looks from a dock at the
  bottom. The chrome and the looks are code you don't edit — adapting it
  for an app means writing screens, which is what keeps every Pilely app's
  picker one recognizable presentation. Its own instructions ship in the same
  16 languages as pilely.app, Arabic and RTL included, and `npm run build`
  emits one self-contained HTML file to hand over.

## Tooling

Not a reference app, and not something to read for how to build one.

- **[`builder_agent_tool_server/`](./builder_agent_tool_server)** — the
  per-build local HTTP server that the agent-style build flow runs on your
  machine.

## Where to start

- **[pilely.app/skill/build_app](https://pilely.app/skill/build_app)** —
  how to build and ship a neoApp, start to finish.
- **[SPA standard](https://pilely.app/skill/standards/spa)** — how a
  Pilely front-end is set up: root-relative Vite `base: "/"` and no router
  basepath (the app owns the root of its own host), `_`-prefixed bundle
  root folders, the i18n layer, theming.
- **[Backend standard](https://pilely.app/skill/standards/backend)** —
  private bind, forwarded-identity trust, and the `GET` = manual /
  `POST` = act dual markdown+JSON surface.

## License

MIT — see [LICENSE](LICENSE). Copy freely.
