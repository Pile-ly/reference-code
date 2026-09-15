# `@pilely/create-pilely-app`

Turns an empty directory into a running, standards-conformant Pilely neoApp:
a Vite + React SPA laid out the way [`@pilely/web`](../../../piles/@pilely/web)
is, with the chosen `@pilely/*` service packages installed, optionally a
working "Login with Pilely" button, and a Hello World page. Nothing else — no
example data, no sample CRUD.

## Two invocation modes, one option schema

**Agent mode** is the default the moment the configuration is complete: give
every required option as a flag and the command runs start to finish with no
prompt, no TTY needed. Something required is missing? It exits non-zero
naming exactly which options are missing and their valid values — it never
hangs waiting on a prompt that will never come.

**Human mode** prompts for the same options, in the same order, when stdin is
a TTY and the configuration is incomplete. `--yes` / `--no-input` force agent
mode even then, turning a still-missing required option into an error instead
of a prompt. Nothing about the emitted project differs between the two modes
— one option schema drives the flag parser, the prompt sequence, `--help`,
and validation, so an option can never be added to one mode and forgotten in
the other.

## Options

| Flag | Type | Default | Required |
| --- | --- | --- | --- |
| `<project-directory>` (positional) | string | — | yes |
| `--services` | csv of `simple-db,simple-blob,simple-group,simple-email`, or `none` | — | yes |
| `--sign-in` / `--no-sign-in` | boolean | `false` | no |
| `--app-id <id>` | string | `REPLACE_WITH_YOUR_PILE_ID` | no |
| `--install` / `--no-install` | boolean | `true` | no |
| `--json` | boolean | `false` | no |
| `--yes` / `--no-input` | boolean | `false` | no |
| `--help` | boolean | `false` | no |

`@pilely/core` is always installed regardless of `--services` — every service
package takes it as a peer, and the app needs it directly. `--app-id`
defaults to the loud `REPLACE_WITH_YOUR_PILE_ID` stand-in; the generated
project fails loudly in the browser (not by silently bouncing through a
failing mint) until that value is replaced with the id from registration.

Run `create-pilely-app --help` for the same option list from the CLI itself,
or `create-pilely-app --help --json` for it as data — the option schema is
the documentation, so an agent can enumerate options instead of parsing
prose.

## One-shot agent example

```sh
create-pilely-app my-app --services simple-db,simple-blob --sign-in --no-install --json
```

Exits 0, prints one JSON object to stdout (the created path, the resolved
options, the files written, and the next commands to run), and prompts for
nothing. `--no-install` skips the package install and makes zero network
calls — useful for an agent with no network. All human-readable progress
text goes to stderr in every mode, so stdout is JSON-only under `--json`.

Or via `npm create`, which forwards everything after `--` to this package's
bin:

```sh
npm create @pilely/pilely-app my-app -- --services simple-db,simple-blob --sign-in --no-install --json
```

## What it generates

```
index.html
package.json          dev / build / preview / typecheck / test
tsconfig.json
vite.config.ts
postcss.config.cjs
src/
  main.tsx
  router.tsx
  vite-env.d.ts
  index_html_conformance.test.ts
  pages/HomePage.tsx
  styles/globals.css
```

With `--sign-in`, `src/components/SignInButton.tsx` (+ its css) and
`src/stores/session_store.ts` are added too, and the Hello World page renders
the button and, when signed in, the handle. `client.js` itself ships in
every project regardless of the flag — it is mandatory, not optional, and
`--no-sign-in` only controls the UI affordance, never the runtime.

Only the directories that have a file in them are created — a scaffold that
plants empty folders is clutter.
