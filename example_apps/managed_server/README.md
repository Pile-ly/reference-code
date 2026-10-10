# Managed server — the `@simple_server` reference backend

A copyable, working Rust/axum backend: **the shape every app with a managed
server starts from.** It is not a static SPA — there is no bundle, no
`simple_db`, nothing declarative. You build a real binary, the platform
builds and runs it for you on its own box (the
[`simple_server` manual](https://simple-server.pilely.app/README.md) is the
service that does so), and it answers traffic on its own host.

```
managed_server/
├── src/           the app (axum, no shared package — see "Self-contained")
├── deploy/        the scripts the manual build/launch proof runs; the
│                  future managed-server service replaces these, not the app
└── README.md      this file
```

## The contract a managed app must meet

Every app the platform builds and boots has to hold up its end of a small,
fixed contract. This project is the reference implementation of it:

- **Bind `0.0.0.0:$PORT`, not `127.0.0.1`.** `PORT` is required, with no
  default — the platform always sets it, and a silent fallback is exactly
  how a box ends up looking healthy on `curl 127.0.0.1:$PORT` while every
  request through the public host times out.
- **`GET /healthz` answers `2xx` fast, with no auth.** The platform polls
  it; failing it is how a box is judged unhealthy.
- **Trust `X-Pile-Requester-Entity` and `X-Pile-Requester-App`, and
  nothing else, for identity.** The platform stamps both on every request:
  the entity is `user:<uuid>` (a person), `app:<uuid>` (another app's
  backend box, admitted by a public route) or `anonymous` (a signed-out
  caller, or no usable token — an agent's token counts as none here), and
  the app is the pile uuid of the app the caller was authenticated on —
  this app's own for its own callers, another app's for a caller a public
  route admits. The caller's `Authorization` never
  reaches the box, no platform session cookie does either, and there is
  no bearer token to verify and no way to reach the login system from
  inside the box. The handle is not part of the identity. `anonymous` is a
  normal caller, not an error. The full table per caller:
  [backend apps](https://pam.pilely.app/specs/backend_apps).
- **The box receives the caller's other headers.** Everything except
  `Authorization`, any caller-sent `X-Pile-*`, `Host` and the hop-by-hop
  headers arrives, `Accept-Encoding`, `Range` and `If-Range` included. The
  caller's `Cookie` arrives with every platform cookie (any name starting
  with `pilely`, after an optional `__Host-` / `__Secure-` prefix) removed,
  and only on a same-origin request, a non-browser request or a top-level
  `GET` / `HEAD` navigation — never on another app's `fetch` or form post. Every
  request also carries `X-Pile-Original-Host` and `X-Forwarded-Host`, the
  host the caller used (`<label>.pilely.app` or a bound custom domain):
  build absolute URLs from it.
- **The box answers like a web server, within an allow-list.** Its status
  and body bytes reach the caller untouched, and so do `Location` (the
  platform follows no redirect, so every `3xx` reaches the caller),
  `Cache-Control`, `ETag`, `Last-Modified`, `Expires`, `Vary`,
  `Content-Disposition`, `Content-Language`, `Content-Encoding`,
  `Content-Range`, `Accept-Ranges`, `Retry-After` and its own `X-*`
  headers. A `Set-Cookie` passes only when it is host-only: no `Domain`
  attribute and a name that does not start with `pilely`. `Cache-Control`
  passes verbatim on an anonymous answer with no `Set-Cookie`; on an
  answer that sets a cookie, or answers a request that carried a token or
  a forwarded `Cookie`, the platform drops `public` and `s-maxage` and
  makes it `private` (a box that sent none gets `private`). Every other
  header is dropped, and the platform's own `Content-Security-Policy`,
  `Cross-Origin-Opener-Policy`, `Referrer-Policy` and CORS answer always
  win; a box never answers its own CORS preflight. The full rules:
  [backend apps](https://pam.pilely.app/specs/backend_apps).
- **Disk is ephemeral.** Nothing written to the filesystem survives a
  restart or a redeploy. This app's `/notes` list is deliberately
  in-memory for exactly that reason — see `GET`/`POST /notes` below.
- **One secret does live on the box: `PILELY_BACKEND_TOKEN`.** The
  platform mints it fresh per launched server and injects it as `app_env`
  in `launch.json`, the same way `SIMPLE_SERVER_ID` arrives. At the
  platform's `simple-*` hosts it is THIS app acting as itself
  (`app:<this app>` on this app) — never a user and never the owner. It
  reaches a resource of this app only where the owner made the app an
  `app` member of the group that guards it (a `simple_env` set's
  `read_group`, a `simple_db` table's groups), and never performs an
  owner-only action. It names no credential this app's own
  code minted or could mint itself; removing the server revokes it
  immediately. See `GET /platform` below for how this project spends it.
- **`SIMPLE_SERVER_ID` and `APP_VERSION` arrive as environment variables**,
  set by the platform at launch. Both are optional from the app's own
  point of view — a local `cargo run` never sets them, and `GET /which`
  answers `null` for whichever is absent.
- **`SIMPLE_ENV_ID` names the box's env set, when it has one.** A box
  added with `server/add {env_id}` gets it in `app_env`; the app reads the
  set once at boot — see "Loading env at boot" below.

## Loading env at boot

`src/simple_env.rs` is the whole client — copy it. When `SIMPLE_ENV_ID`
is set, `main` reads the set before binding:

```
POST https://simple-env.pilely.app/<SIMPLE_ENV_ID>/get
Authorization: Bearer <PILELY_BACKEND_TOKEN>
Accept: application/json

{}
```

A `200` answers the bare stored object, `{KEY: VALUE, ...}` (values are
any JSON, `{}` for an empty set), which `SimpleEnv::load` returns as a
`serde_json::Map`. **Anything else fails boot** through `Fatal::exit`: a
non-200 (`404 not_found` means the app is not an `app` member of the set's
`read_group`, or the set is gone), an unreachable service, a 200 that is
not an object, or `SIMPLE_ENV_ID` without `PILELY_BACKEND_TOKEN`. A box
that serves without the env it was launched with is worse than one that
does not start. The log line names the key count only, never a value.

With no `SIMPLE_ENV_ID` (a local `cargo run`, or a box added without an
env set) nothing is read. There is no npm or JS client for this: boxes are
Rust, and owners manage sets over `simple-env.pilely.app`'s HTTP routes.

## Routes

| route | behaviour |
|---|---|
| `GET /healthz` | `200 ok`; no auth, never logged |
| `GET /` | `hello from managed-server-reference`; the app's markdown manual on `GET /index.md` or `Accept: text/markdown` |
| `GET /whoami` | `{entity, app}` from the two forwarded-identity headers; `null` for either that is absent (only with no platform in front). The route's markdown manual on `GET /whoami.md` or `Accept: text/markdown` |
| `POST /echo` | the request body back, with its `Content-Type` (`application/octet-stream` if none was sent) |
| `GET /which` | `{server_id, version}` from `SIMPLE_SERVER_ID` / `APP_VERSION`; `null` for either that was never set |
| `GET /notes` | every note still held, oldest first, as a JSON array of strings |
| `POST /notes` | the raw request body, decoded as UTF-8, becomes one note; `201` on success, `400` if not valid UTF-8, `413` over 4 KiB |
| `GET /platform` | this server's own `PILELY_BACKEND_TOKEN` spent at `simple-db.pilely.app/apps/list`; answers `{status, body}` from that call verbatim, or `503 {"error":"no_backend_token"}` when the variable is unset. `apps/list` lists a person's own databases only, so a recognized token gets `simple-db`'s uniform `404` there; an unrecognized one gets `401` |
| any method on `/webhooks` and every path below it | every request header this box received, as a JSON object of lowercased header name to value (a repeated header's values joined with `, `), for every caller, `anonymous` included — the header echo the platform's live proof reads to see which caller headers root forwards to an owner backend |

`/notes` is capped at 100 entries — the oldest is dropped once a new one
would exceed it — **and** each note at 4 KiB: the entry cap alone bounds
count, not memory, since every accepted note is retained until evicted.
Together the two keep the list's worst case in the low hundreds of KiB,
nowhere near the box's `memory_max_mib`. The list **resets on every
process start**: it is deliberately never persisted, per "disk is
ephemeral" above.

One line is logged per request to stdout via `tracing` — method, path,
status, elapsed milliseconds — except `/healthz`, which is never logged.
Nothing else goes to stdout.

## The `.md` suffix: this app owns it

A backend app's `GET` routes answer a markdown manual when the caller
appends `.md` — the same convention every platform service follows for its
own manual at `/README.md` (the directory of them is the
[platform README](https://pilely.app/README.md)). The platform forwards
`/x.md` to the app exactly as the caller sent it, with the caller's own
`Accept` — it never strips the suffix or renders markdown on the app's
behalf, so mapping `.md` is the app's job.

This app does it in `src/md_suffix.rs`, before any route matches: `/x.md`
becomes `/x`, `/index.md` becomes `/`, `/x/index.md` becomes `/x/`, the
query string is kept, and `Accept` is set to `text/markdown` — for every
method, so `POST /echo.md` reaches the same handler as `POST /echo`. The
request log then records the bare path (and `/healthz.md`, like
`/healthz`, is never logged).

`GET /` and `GET /whoami` answer a markdown manual on that `Accept`; their
plain text and JSON are unchanged otherwise. The other routes still answer
their plain text or JSON whatever `Accept` says — a deliberate
simplification: a copier building a managed app that wants a manual on
every route adds it the same way `routes/whoami/index.rs` does.

## Run it locally

```bash
PORT=8080 cargo run
curl localhost:8080/healthz          # ok
curl localhost:8080/whoami           # {"entity":null,"app":null}
curl localhost:8080/whoami.md        # the /whoami manual, as markdown
curl -X POST -d 'hi' localhost:8080/echo   # hi
curl -X POST -d 'first' localhost:8080/notes
curl localhost:8080/notes            # ["first"]
```

`cargo test` runs the whole suite (unit tests colocated next to the code
they cover — no `e2e_tests`, since there is no external dependency to test
against: no database, no queue, nothing but the process itself).

## Zip it for `start-build`

The build job unpacks the zip and runs `cargo build --release` at its root,
so `Cargo.toml` must be at the top level of the archive — not nested one
directory down:

```bash
deploy/zip_source.sh   # -> managed_server.zip, excludes target/ and .git
```

The archive must stay under 50 MiB; `target/` is the only thing in this
project large enough to matter, and the script excludes it.

## `deploy/`

Three scripts and one `.sql` file used to run this project's own manual,
one-off proof against production — registering the app, building,
launching a box, flipping the row, tearing it down. A future
managed-server platform service performs this same sequence through its
own routes; these are a stand-in for that, not part of the app. Each
script's own header (and `set_target.sql`'s) says so and states what it
needs (a monorepo checkout, an authenticated `aws` CLI, an active
`pile.ly` session) that a plain copy of this directory does not have on its
own — read a file's header before running it.

## Live proof (2026-09-12)

Every line below was run live against real AWS and the real production
`pilely.app`, as the owner `@lxhao403`, never by reading a template.

Registered app: `managed_server_reference` (`title_i18n.en:
managed-server-reference` — the task's naming, though the platform's path
charset does not allow hyphens), pile id
`0fecc4c8-b66d-496d-a3bd-2ab2d5165356`, host `bwkm1ddy.pilely.app`, `public`,
`backend`.

Builder image tag `1.92.0-20260912` (bumped for this task — see
`production/aws/cloud_formation/production/pilely/simple_server_build/README.md`'s
"Deployed state" section for the full record).

| step | check | result |
|---|---|---|
| 3 | `zip_source.sh` then `start_build.sh` → `SUCCEEDED`, sha256 recorded, artifact + manifest at the expected prefix | first attempt failed on a real bug in `start_build.sh` (its stack-export lookup picked an ARN instead of a bare bucket name — fixed, see the deploy script's own history); second attempt: build `lmcd-prod-simple-server-build:7803b2bc-09d5-4479-8a6f-0a8871a26156`, `SUCCEEDED`, sha256 `5ca3a1f6f1e66c50d02639333e64779fc6b0deb9534f198a56895392b1849415`, artifact at `s3://lmcd-prod-simple-server-build-artifacts/<storage key>/1/app` |
| 4 | `launch.sh` → instance + private IP; healthy within 120s | instance `i-0e7da2dcb7e78437d`, IP `10.65.2.117`; `simple-server-app.service` active **24s** after `RunInstances` — confirmed over SSM (`curl 0.0.0.0:8080/healthz` → `200 ok`); `aws ecs execute-command` into a prod root task was unavailable this run (`TargetNotConnectedException` on every running task — a pre-existing infra issue, not this app's), substituted with the SSM check plus the edge proof below, which exercises the exact same network path |
| 5 | row flip, then six checks on `https://bwkm1ddy.pilely.app` within 30s | `GET /.md` → `hello from managed-server-reference`; `GET /healthz.md` → `ok`; `GET /whoami.md` anonymous → all `null`; with an app-scoped id token minted for the host → `{"user_id":"...","handle":"lxhao403","app_id":null}`; `POST /echo` with that token → the body back, `200`; `GET /which.md` → `{"server_id":"managed-server-reference-01","version":"1"}`; `POST /notes` ×2 then `GET /notes.md` → both strings, `201`/`200` |
| 6 | CloudWatch stream has one line per request above, none for `/healthz`; `sudo -u app cat /etc/simple_server/launch.json` denied | both confirmed — the app's log group carries exactly the requests from step 5, and the `cat` returned `Permission denied` |
| 7 | `systemctl restart simple-server-app` → `/notes.md` empty, `/healthz.md` still `ok` | confirmed — the in-memory list resets on every process start, per this app's design |
| 8 | teardown: terminate, clear `direct_http_url`, origin → hosted-offline within 15s, no `product=simple_server` instance remains | instance terminated; origin answered `503 pile_offline` **5s** after the clear; `describe-instances` for `product=simple_server` in any live state returned nothing |

Resting state after this run: the app stays registered, its binary stays at
the artifact key above in S3, `forward_mode` is `managed_http` and
`direct_http_url` is `NULL` (a managed_http pile with no box running answers
the hosted-offline envelope, never a 500).

### Deviations from the task text

- `POST /~/apps/register`'s JSON response (and `POST /~/apps/list`'s) do not
  carry `bundle_nanoid`, even though the field is minted at register time —
  it had to be read back with a direct row query.
- `deploy/set_target.sql`'s two `UPDATE`s (and the teardown clear) were
  applied through the platform's own PostgREST API with a service-role
  key, not `psql` — no Postgres connection string is available to an agent
  running this proof, only that REST endpoint, both sourced from SSM at
  runtime the same way the deploy scripts source their R2 credentials.
- `start_build.sh` failed once on a genuine bug (a CloudFormation-output
  lookup that matched an ARN instead of a bucket name) — fixed before the
  build that produced the artifact above; see the script's own commit
  history for the fix.
- The "curl from a prod ECS host" leg of step 4 was substituted with an
  equivalent SSM check directly on the box, because ECS Exec into the
  production root service was unavailable during this run (a pre-existing
  infrastructure issue, unrelated to this app).

## Self-contained

No shared package, no path dependency, no import from anywhere outside this
directory. Copy `managed_server/` on its own and it builds.
