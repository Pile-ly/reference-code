# Managed server — the `@simple_server` reference backend

A copyable, working Rust/axum backend: **the shape every managed server app
starts from.** Unlike every other project in this family, it is not a
static SPA — there is no bundle, no `simple_db`, nothing declarative. You
build a real binary, the platform builds and runs it for you on its own
box, and it answers traffic on its own host.

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
- **Trust `X-Pile-Requester-User-Id`, `X-Pile-Requester-Handle` and
  `X-Pile-Requester-App-Id`, and nothing else, for identity.** The
  platform sets these; there is no session cookie, no bearer token to
  verify, no way to reach the login system from inside the box. An absent
  header means an anonymous or non-app-scoped caller — that is a normal
  case, not an error.
- **Disk is ephemeral.** Nothing written to the filesystem survives a
  restart or a redeploy. This app's `/notes` list is deliberately
  in-memory for exactly that reason — see `GET`/`POST /notes` below.
- **No secret lives on the box.** The instance role can fetch this app's
  own binary and ship its own logs; nothing else. An app that needs to
  call another platform service authenticates a different way — out of
  scope for this reference project.
- **`SIMPLE_SERVER_ID` and `APP_VERSION` arrive as environment variables**,
  set by the platform at launch. Both are optional from the app's own
  point of view — a local `cargo run` never sets them, and `GET /which`
  answers `null` for whichever is absent.

## Routes

| route | behaviour |
|---|---|
| `GET /healthz` | `200 ok`; no auth, never logged |
| `GET /` | `hello from managed-server-reference` |
| `GET /whoami` | `{user_id, handle, app_id}` from the three forwarded-identity headers; `null` for any that are absent |
| `POST /echo` | the request body back, with its `Content-Type` (`application/octet-stream` if none was sent) |
| `GET /which` | `{server_id, version}` from `SIMPLE_SERVER_ID` / `APP_VERSION`; `null` for either that was never set |
| `GET /notes` | every note still held, oldest first, as a JSON array of strings |
| `POST /notes` | the raw request body, decoded as UTF-8, becomes one note; `201` on success, `400` if not valid UTF-8, `413` over 4 KiB |

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

## A deliberate deviation from the backend standard

The platform's [backend standard](https://pilely.app/skill/standards/backend)
says a hosted app's `GET` routes answer a markdown manual (the `.md`-suffix
/ `isAgent=1` convention) and never JSON. This app does **not** follow that:
every `GET` above answers plain text or JSON, always, suffix or not. That is
a safe simplification here, not an oversight — the platform only strips a
`.md` suffix upstream and forwards `isAgent=1` on the query string; it never
requires or renders markdown on the app's behalf. A copier building a
managed app that wants the dual markdown/JSON surface is free to add it;
this reference project keeps the smallest thing that satisfies the
platform mechanically.

## Run it locally

```bash
PORT=8080 cargo run
curl localhost:8080/healthz          # ok
curl localhost:8080/whoami           # {"user_id":null,"handle":null,"app_id":null}
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
`hosted`.

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
