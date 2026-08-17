# Pilely reference code

> **Read-only mirror.** This repository is synced automatically from an
> internal monorepo. Pull requests are not accepted and will be closed;
> history is rewritten on every sync (each publish is a single squashed
> commit).

Complete, working reference apps for [pilely.app](https://pilely.app).
Copy the one closest to what you're building and adapt it — don't
re-derive the setup from scratch.

Each top-level directory is one self-contained project. Clone the repo,
or grab the
[source zip](https://github.com/Pile-ly/reference-code/archive/refs/heads/main.zip)
and take just the directory you need.

## Projects

- **[`blog/`](./blog)** — the SPA example: a personal blog as a **static**
  neoApp (no backend) on the managed database
  ([simple_db](https://pilely.app/skill/app_management/simple_db)). The
  owner writes; anyone — signed in or not — reads; signed-in users comment
  and like. Built to the
  [SPA standard](https://pilely.app/skill/standards/spa); its
  [`build_instruction.md`](./blog/build_instruction.md) walks the whole
  server side: registration → database → table access design → bundle
  upload. Two placeholders to fill (owner handle, pile id) — see
  [`blog/README.md`](./blog/README.md).

- **[`plant_tracker/`](./plant_tracker)** — the private-app example: a
  plant-watering tracker as a **static** neoApp for exactly one user (its
  owner), on the managed database
  ([simple_db](https://pilely.app/skill/app_management/simple_db)) and
  blob store
  ([simple_blob](https://pilely.app/skill/app_management/simple_blob)).
  Shows `access_mode: "private"`, the empty-group "only me" idiom on every
  table and blob, the camera → downscale → upload photo pipeline,
  per-render download links, and client-side cascade deletes. Its
  [`build_instruction.md`](./plant_tracker/build_instruction.md) walks
  registration → group → tables → the blob contract → bundle upload. Three
  placeholders to fill (pile id, group nanoid, title) — see
  [`plant_tracker/README.md`](./plant_tracker/README.md).

- **[`storefront/`](./storefront)** — a small-business website (the demo
  is a boxing gym): fully static marketing pages whose content lives in
  one config file, plus the
  [simple_db](https://pilely.app/skill/app_management/simple_db) **inbox
  recipe** — a sign-in-gated inquiry form anyone can submit and only the
  owner can read (empty read group), listed on an owner-only admin page
  with cursor paging. The leanest reference app: one table is the whole
  database. See [`storefront/README.md`](./storefront/README.md).

- **[`event_rsvp/`](./event_rsvp)** — a two-sided public app (the demo is
  a supper club): the host publishes events that **anyone reads, signed in
  or not**, any signed-in guest sends an RSVP to a table **only the host
  can read**, and a host portal joins the two. Two
  [simple_db](https://pilely.app/skill/app_management/simple_db) tables
  that are mirror images of each other, sharing one empty group on
  opposite axes; cover photos are
  [simple_blob](https://pilely.app/skill/app_management/simple_blob)
  uploads marked `anon_read` so signed-out visitors see them. Shows the
  consequences too: a guest can never read their RSVP back, so changing an
  answer means sending another row and the portal dedupes to the latest
  per submitter. See [`event_rsvp/README.md`](./event_rsvp/README.md).

More apps land here as they're written. The standards below are complete
on their own and are enough to build against.

## Shared components

- **[`sign_in_button/`](./sign_in_button)** — not an app: the
  **"Login with Pilely"** affordance on its own. Every Pilely app labels
  sign-in with that one name, because a visitor should recognize it and
  know their password is only ever typed on the platform, never into an
  app. A dependency-free React component, the reference CSS, and a static
  [`preview.html`](./sign_in_button/preview.html) you can open to see it in
  both themes. It also carries the two rules a hand-rolled gate usually
  gets wrong: wait for `window.pilely.ready` before deciding who is there,
  and gate on `user() === null` — never on a 401, which a public app's
  anonymous token means you'll never see. See
  [`sign_in_button/README.md`](./sign_in_button/README.md).

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
