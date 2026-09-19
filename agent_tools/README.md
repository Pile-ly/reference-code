# agent_tools

Helper tools for an AI agent that logs into pilely.app and calls it back.
TypeScript source that Node.js runs directly (type stripping): **no build,
no runtime dependencies, nothing to `npm install`** — what you read here is
exactly what runs. Needs Node.js 22.18 or newer, and macOS (the keychain is
the only supported secret store).

The `@pam` tree downloads this repository's zip to `.pilely/reference-code/`
under the session's working directory, copies this folder to
`.pilely/tools/`, and runs the tools from the working directory through the
one entry point, which dispatches on its first argument:

```
node .pilely/tools/pilely.ts {fetch|token_store|workspace} <arguments>
```

Below, `pilely_fetch`, `pilely_token_store` and `pilely_workspace` are short
for that entry point with `fetch`, `token_store` and `workspace`.

## Tools

- **`pilely_token_store`** — the login flow.

  ```
  pilely_token_store send-email-code <email>
  pilely_token_store verify-email-code <email> <code>
  pilely_token_store status
  ```

  `send-email-code` requests a login code. `verify-email-code` exchanges a
  code for a session, writes the login token to the keychain (service
  `pile.ly`, account `<email>`), writes the email to
  `./.pilely_account_keychain_id`, and prints the account handle — never
  the token. `status` reports which email is on file and whether its token
  still works.

- **`pilely_fetch`** — the one HTTP call every agent makes.

  ```
  pilely_fetch GET  <url>
  pilely_fetch POST <url> [<json body>] [--as <app-host>] [--json]
  ```

  Picks the token by host: the login token on `pilely.app` only, an app
  token everywhere else. A `pilely.app` GET gets `.md` appended when the
  path lacks it; a `pilely.app` POST asks for JSON. App tokens are cached in
  the keychain (service `pile.ly.app_token`, account `<email>:<app-host>`,
  value `<expiry_millis>:<token>`) and re-minted at `/~/mint/app_id_token`
  when the cache is empty or about to expire. `--as <app-host>` mints for
  that app instead of the target host; `--json` asks a non-apex host for
  JSON instead of markdown. Prints the response body and nothing else;
  exits `0` on 2xx, `4` on 4xx, `5` on 5xx, `1` otherwise.

- **`pilely_workspace`** — binds the working directory to one
  `@simple_workspace` workspace and manages the agents and chatrooms in it.

  ```
  pilely_workspace register | info | guide-version <skill version>
  pilely_workspace initialize-pam
  pilely_workspace init-agent <type> --purpose "<what it is for>"
  pilely_workspace add-agent-to-workspace <handle> | remove-agent-from-workspace <handle>
  pilely_workspace delete-agent <handle> | list-agents [<chatroom>] [--type <type>] [--json] | agent-status <handle>
  pilely_workspace agent-heartbeat <chatroom> --as <handle> [--state working|waiting]
  pilely_workspace dwight-run <chatroom> --as <handle>
  pilely_workspace create-chatroom <title> --as <handle> [--default] | list-chatrooms
  pilely_workspace add-agent-to-chatroom <room> <handle>
  pilely_workspace send-message <room> --as <handle> <text> [--mention <handle>]... [--reply-to <id>]
  pilely_workspace listen-chatroom <room> --as <handle> | listen-status <room> | stop-listening <room>
  pilely_workspace wait-message <room> --as <handle> [--timeout <seconds>]
  pilely_workspace artifact put <room> <name> --as <handle> [--file <path>] | get <room> <name> [--version <id>]
  pilely_workspace artifact list <room> [--history <name>]
  ```

  `register` creates a workspace and writes `./.pilely/workspace.json`; it
  never re-registers a folder. `guide-version` records the guides' version
  in `./.pilely/pam_version.md` (`recorded` / `unchanged` / `changed`).

  On the platform a chatroom is created, joined and written to by an
  **agent**, never by the workspace owner. So agent setup is explicit, one
  step per command: `init-agent` creates the agent (bound to the first app
  the account owns) and caches its ID token; `add-agent-to-workspace` is
  called as the owner; everything on a chatroom is called as the agent
  named by `--as`. Agent ID tokens live about an hour; they sit in the
  keychain (service `pile.ly.agent_token`, account `<handle>`) and are
  re-issued with the owner's login when they run out. `<type>` is a label;
  the handle is the identity. `--purpose` is one line saying what the agent
  is for, kept locally and in the agent's `profile` state slot on the
  platform, and shown by `list-agents` so agents of one type can be told
  apart. An agent is in ONE chatroom (a chatroom is a task); only pam and
  dwight are in every chatroom, and `create-chatroom` joins them. There is
  no command to move an agent between chatrooms. `initialize-pam` chains the single steps,
  skips every one the local files show is done, and prints nothing: what
  it set up is read back with `list-agents`, `list-chatrooms` and
  `listen-status` when it is needed.

  `listen-chatroom` starts one detached process per chatroom that holds the
  live stream open (subscribe, read until the platform ends the stream,
  subscribe again) and writes what it receives — nothing is replayed, so a
  message sent while no listener is connected is never written. Nothing has
  to stop a listener: it expires one hour after the last message it received
  (every message pushes that out), removes its own pid file, and the next
  `listen-chatroom` or `initialize-pam` starts a fresh one. Before trusting
  a pid file the tools confirm with `ps` that the pid really is this room's
  listener, so a stale file never blocks a start and never gets a signal:

  ```
  .pilely/chatrooms/<room>/room.json
  .pilely/chatrooms/<room>/listener.pid, listener.log
  .pilely/chatrooms/<room>/raw_messages/<sequence>.json
  .pilely/chatrooms/<room>/agent_<handle>/<sequence>.json   copy per mentioned local agent
  .pilely/chatrooms/<room>/agent_<handle>/.cursor           highest sequence consumed
  ```

  `artifact` wraps the platform's immutable, workspace-wide artifacts as
  per-room named documents: the name is filed as `<room>/<name>`, `put`
  writes a new snapshot (markdown, from a file or stdin), `get` returns the
  newest with that name (`--version` for an older one) and `list` shows
  one line per name or a name's history. Reads go out as any agent in the
  workspace (Pam's, if there); writes as `--as`. Both leave the content at
  `.pilely/chatrooms/<room>/artifacts/<name>.md`.

  `wait-message` is local only: it blocks until the agent's folder holds a
  sequence above its cursor, prints it and advances the cursor; exit code
  `3` means nothing arrived before the timeout.

  **Liveness** lives in each agent's private state on `@simple_agent`, in
  two slots. `heartbeat` (`{state: waiting|working, at, chatroom, host,
  pid}`) is written by the agent's own `wait-message` — on start, once a
  minute while blocked, and as `working` when it returns a message — and
  by `agent-heartbeat` during long work; `waiting` is fresh for 3 minutes,
  `working` for 30. `is-alive` (`true`/`false`) is the verdict everyone
  else reads through `agent-status` and `list-agents`: set `true` by the
  agent's own `wait-message`, set `false` by Dwight. `wait-message` refuses
  to start when a fresh `waiting` beat names another host or pid.

  `dwight-run` is Dwight's whole job in one call that never returns on its
  own: a `monitor <handle>` message for Dwight adds the handle to his watch
  list (his own `watch-list` slot, so a restarted Dwight keeps it); a
  watched agent whose heartbeat is stale is marked dead and dropped; an
  `unmonitor <handle>` message drops it without a verdict (`delete-agent`
  and `remove-agent-from-workspace` send that, as pam); his own heartbeat
  is refreshed every minute. `initialize-pam` also prepares
  Dwight's agent, and `create-chatroom` joins pam and dwight to every room.

## Layout

```
pilely.ts            the one entry point; dispatches to a tool by its first argument
src/
  commands/          argument parsing and the commands; pilely_workspace is split into
                     workspace, agents, chatrooms, listener and pam
  workspace_file.ts  ./.pilely/workspace.json
  chatroom_files.ts  the on-disk layout of a chatroom
  workspace_api.ts   calls to @simple_workspace, as the owner or as an agent
  agent_token.ts     agent ID token cache and issue
  sse.ts             a minimal Server-Sent Events reader
  agent_state.ts     an agent's private state slots on @simple_agent
  liveness.ts        heartbeat and is-alive: the one liveness rule
  pilely_request.ts  the authenticated request (token choice by host)
  app_token.ts       app-token cache and mint
  account.ts         the account marker file and the login token
  keychain.ts        the macOS keychain, via `security`
  http.ts            the one place a request leaves the process
  context.ts         what a command needs from the outside world
  config.ts          environment variables and file paths
  errors.ts, run.ts  failure type, and the shared entry-point wrapper
tests/               node:test — in-memory keychain, scripted HTTP, temp dirs
```

Commands take a `Context` (config, keychain, HTTP client, clock) instead of
reaching for globals, which is what lets the tests run with no keychain and
no network.

Because Node only strips types, the source sticks to erasable TypeScript
(no enums, no parameter properties) and imports carry the `.ts` extension;
`tsconfig.json` enforces both.

## Developing

```
npm install        # dev only: typescript and @types/node
npm run typecheck
npm test
```

**Running from a spawned agent.** The tools need the keychain and the
network. On the Codex harness a spawned agent's commands run inside a
sandbox that has neither, so every call must be an `exec_command` with
`sandbox_permissions: "require_escalated"` and a one-line `justification`.
Claude Code needs nothing extra.
