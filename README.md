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
and take just the directory you need. Every project is self-contained: no
imports between projects, nothing outside its own directory. The one
thing here that is installed rather than copied is the published `@pilely`
packages under `npm/`.

## Example apps

**Start at [`example_apps/README.md`](./example_apps).** It is the index:
a chooser table, and for each app the services it uses, its access model,
and exactly what an anonymous visitor, a signed-in user and the owner can
each do. Pick from there rather than guessing from the names.

- **[`example_apps/managed_server/`](./example_apps/managed_server)** — a
  real backend. A self-contained Rust/axum binary the platform builds and
  runs on its own box
  ([simple_server](https://simple-server.pilely.app/README.md)), for apps
  that need actual server-side code instead of a UI over the managed
  database. It has no database or bundle to declare: its own `README.md`
  and `deploy/` are the whole sequence — register, build, launch.

The frontend-only shapes — the owner publishes and the world reads, only
me, a public face with a private inbox, and the rest — are described by
the platform's [recipes](https://pam.pilely.app/recipes): who reads, who
writes, which services carry it, and the setup and code that follow.

More apps land here as they're written. If none matches your pattern, the
recipes and the service manuals below are complete on their own and are
enough to build against.

## Client packages

These are installed, not copied — the opposite of everything else in this
repository. **Start at [`npm/`](./npm)**, the index of the whole workspace.
Every package is published on the npm registry under the `@pilely` scope
(`npm install @pilely/core @pilely/simple-db`).

- **`@pilely/core`** — `<PilelyProvider>`, `usePilelyAuth()` and mock
  mode: the React view of the platform's `client.js` runtime.
- **`@pilely/simple-db`** — wraps the managed database
  ([simple_db](https://simple-db.pilely.app/README.md)).
- **`@pilely/simple-blob`** — wraps managed file storage
  ([simple_blob](https://simple-blob.pilely.app/README.md)).
- **`@pilely/simple-group`** — wraps managed group membership and
  permissions ([simple_group](https://simple-group.pilely.app/README.md)).
- **`@pilely/simple-email`** — wraps managed transactional email
  ([simple_email](https://simple-email.pilely.app/README.md)).
- **`@pilely/create-pilely-app`** — scaffolds a new app on the packages,
  mock mode included: `npm create @pilely/pilely-app`.

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

- **[`agent_tools/`](./agent_tools)** — the two bash scripts an AI agent
  runs to log into pilely.app and call it back: `pilely_token_store` and
  `pilely_fetch`.

## Where to start

- **[Platform README](https://pilely.app/README.md)** — accounts, login,
  the app registry (register, publish, subdomains, public routes) and app
  tokens, plus the directory of every service's own `README.md`.
- **[Recipes](https://pam.pilely.app/recipes)** — the ways an app is
  built on Pilely, one shape per recipe: who reads, who writes, which
  services carry it, and the setup and code that follow.
- **[Frontend apps](https://pam.pilely.app/specs/frontend_apps)** — the
  browser runtime (`client.js`, `window.pilely`, the `pilely-app` meta
  tag), how a bundle is served, and who pays for an app's traffic.
- **[Backend apps](https://pam.pilely.app/specs/backend_apps)** — how
  root forwards requests to a backend's box, the forwarded-identity
  headers it stamps, and public routes.

## License

MIT — see [LICENSE](LICENSE). Copy freely.
