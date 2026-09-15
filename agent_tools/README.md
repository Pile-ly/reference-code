# agent_tools

Two bash, macOS-only scripts for an AI agent that logs into pilely.app and
calls it back — the login flow, and the one HTTP call every other call goes
through. The `@pam` tree downloads this repository's zip to
`.pilely/reference-code/` under the session's working directory on every
fresh session and runs both scripts from there; the account marker they share
(`./.pilely_account_keychain_id`) is relative to that same directory.

- **`pilely_token_store`** — the login flow, and the only script here that
  reads or writes the macOS keychain.

  ```
  pilely_token_store send-email-code <email>
  pilely_token_store verify-email-code <email> <code>
  pilely_token_store status
  ```

  `send-email-code` requests a login code. `verify-email-code` exchanges a
  code for a session, writes the login token to the keychain (service
  `pile.ly`, account `<email>`), writes the email to
  `./.pilely_account_keychain_id` in the current directory, and prints the
  account handle — never the token. `status` reports which email is on
  file and whether its token still works.

- **`pilely_fetch`** — the one HTTP call every agent makes. It reads the
  email from `./.pilely_account_keychain_id`, then the matching token from
  the keychain, and picks the token by host: the login token on
  `pilely.app` only, an app token everywhere else.

  ```
  pilely_fetch GET  <url>
  pilely_fetch POST <url> [<json body>] [--as <app-host>]
  ```

  A `pilely.app` GET gets `.md` appended when the path lacks it; a
  `pilely.app` POST gets `Accept: application/json`. Any other host gets an
  app token — cached in the keychain (service `pile.ly.app_token`, account
  `<email>:<app-host>`, value `<expiry_millis>:<token>`) and re-minted at
  `/~/mint/app_id_token` when the cache is empty or expired. `--as
  <app-host>` mints for that app and sends the token to the URL's own
  host, for calling a `simple_*` service on an app's behalf; without it the
  token is minted for the target host itself. The login token is never
  sent off `pilely.app`.

  It prints the response body and nothing else, and exits with the HTTP
  response class: `0` on 2xx, `4` on 4xx, `5` on 5xx.

**Running them from a spawned agent.** Both scripts need the keychain and
the network. On the Codex harness a spawned agent's commands run inside a
sandbox that has neither, so every call to either script must be an
`exec_command` with `sandbox_permissions: "require_escalated"` and a
one-line `justification`. A sandboxed call fails as "no login token
stored" plus a DNS error even when the main session is logged in;
approvals are per command and never inherited. Claude Code needs nothing
extra.

Run `tests/test_pilely_token_store.sh` and `tests/test_pilely_fetch.sh` to
check either script — both are pure bash, stub `curl` and `security` on
`PATH`, and make no network calls.
