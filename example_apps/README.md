# Example apps

Complete, working Pilely apps. Each one is a **shape** — an answer to "who
is allowed to see and do what", and which platform services carry it. Find
your row below, open that project, copy it.

## Which one do I read?

| If you're building… | Read | Services | Shape |
|---|---|---|---|
| I need a real backend | [`managed_server/`](./managed_server) | `simple_server` — it *is* the backend | managed Rust server |

Access at a glance: `managed_server` is not a `simple_db` app, so there is
no `read_group` / `anon_read` / `write_group` table to show for it. Who can
do what is decided by the app's own code — see its section below.

The frontend-only shapes — the owner publishes and the world reads, only
me, a public face with a private inbox, a members-only shared space, and
the rest — are no longer carried as example apps here. The platform's
[recipes](https://pam.pilely.app/recipes) describe each one: who reads,
who writes, which services carry it, and the setup and code that follow.

Every project is self-contained: no imports between projects and no path
into any repository around them — you copy one directory and go.

---

## `managed_server/` — a real backend

**Pattern.** A self-contained Rust/axum binary the platform builds through
its own build job and runs on its own box, reached at the app's host the
same way a static bundle is.

**Infrastructure.** A managed server
([`simple_server`](https://simple-server.pilely.app/README.md)), not
`simple_db` / `simple_blob` / `simple_group` — there is no database, no
bundle, no `build_instruction.md` sequence. The app is built from a source
zip, launched on a `t4g.nano` under systemd, and the platform forwards
HTTP straight to the box.

**Access model.** N/A — this project has no `simple_db` tables, so the
`read_group` / `anon_read` / `write_group` shape a data app uses does not
apply. Identity instead arrives as two forwarded headers
(`X-Pile-Requester-Entity` / `-App`: who is calling, and the app they
were authenticated on) the app trusts directly; see the project's own
README for the full contract.

**Who can do what.** Entirely up to the app's own code — the platform
draws no access boundary for a managed server the way it does for
`simple_db`. This reference app itself answers every route to anyone who
can reach its host, anonymous or not, since demonstrating the platform
contract is its only job.

**Copy this when** your app's logic doesn't fit "a UI over a managed
database" — you need your own server-side code, a language runtime, a
background job, or a real HTTP API of your own.

**The lesson worth carrying.** The whole contract is five things: bind
`0.0.0.0:$PORT` (not `127.0.0.1` — a loopback bind looks healthy locally
and times out at the edge), answer `GET /healthz`, trust the two
forwarded-identity headers as the only truth about who is calling, treat
disk as ephemeral, and never hold a secret on the box. Everything else in
the reference app is demonstrating those five things, not adding to them.

## What is not here yet

- **No frontend-only example app.** The
  [recipes](https://pam.pilely.app/recipes) cover those shapes, and each
  service's manual is complete on its own: the directory of them is the
  [platform README](https://pilely.app/README.md).
- If the pattern above does not match yours, the recipes and the service
  manuals are enough to build from directly. Don't force your app into
  the nearest project.

## Also worth reading

- [`../reusable_components/sign_in_button/`](../reusable_components/sign_in_button) — the **"Login with Pilely"**
  affordance on its own: the button and the sign-in rules, for a frontend
  that gates by hand.

## Before you ship a copy

`managed_server/` has no `build_instruction.md`: there is no database or
bundle to declare, so its own `README.md` and `deploy/` are the whole
sequence — register, build, launch, flip the row. Its README lists the
placeholders to fill.
