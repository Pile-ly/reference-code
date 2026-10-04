# `@pilely/simple-email`

React hooks for the `simple_email` service — the platform's managed transactional email. A query hook for every read, a mutation hook for every write. Render them inside `@pilely/core`'s `<PilelyProvider>`.

## Hooks

| Hook | Wraps | Kind |
| --- | --- | --- |
| `useSend()` | `/send` | mutation, `{ to, subject, html }` or `{ to, template_id, variables? }` |
| `useSends({ limit? })` | `/sends/list`, paged | infinite query; this app's outbox, `SendRow[]` |
| `useEmailAccount()` | `accounts/{app}/info` | query; this app's account with its daily cap, sent today, credit and phone state |
| `useEmailAccounts({ limit? })` | `accounts/list`, paged | infinite query; every account the caller owns |
| `useCreateEmailAccount()` | `accounts/create` | mutation, the optional send group |
| `useDeleteEmailAccount()` | `accounts/{app}/delete` | mutation, no variables |
| `useSetEmailAccountAccess()` | `accounts/{app}/access/set` | mutation, the send group (`null` = owner-only) |
| `useTemplates({ limit? })` | `templates/list`, paged | infinite query; metadata only |
| `useTemplate(templateId)` | `templates/{t}/info` | query; the template with its `html`; an `undefined` id disables it |
| `useCreateTemplate()` | `templates/create` | mutation, `{ name, subject, html }` (`name` may be `null`) |
| `useUpdateTemplate()` | `templates/{t}/update` | mutation, `{ templateId, subject, html }` — a full replace |
| `useDeleteTemplate()` | `templates/{t}/delete` | mutation, the template id |

The app id is added from `@pilely/core` on every route; it is never a variable. Every write waits for the server: an email "sent" before the server accepted it would be a lie.

## What each write refreshes

| Write | Invalidates |
| --- | --- |
| send | `useSends()` |
| account create / set access | `useEmailAccounts()`, `useEmailAccount()` |
| account delete | `useEmailAccounts()`, `useEmailAccount()`, and the templates under it |
| template create | `useTemplates()` |
| template update / delete on `t` | `useTemplates()`, `useTemplate(t)` |

## Example

```tsx
import { useSend, useSends } from "@pilely/simple-email";

export function Outbox() {
  const { data: sends } = useSends();
  const send = useSend();
  return (
    <>
      <button onClick={() => send.mutate({ to: ["friend@example.com"], subject: "Hi", html: "<p>Hello</p>" })}>
        Send
      </button>
      {send.error && <p role="alert">{send.error.message}</p>}
      <ul>{sends?.map((row) => <li key={row.send_id}>{row.subject} — {row.outcome}</li>)}</ul>
    </>
  );
}
```

## Query keys

| Key | Query |
| --- | --- |
| `["pilely", "simple-email", "sends", { limit }]` | `useSends` |
| `["pilely", "simple-email", "account"]` | `useEmailAccount` |
| `["pilely", "simple-email", "accounts", { limit }]` | `useEmailAccounts` |
| `["pilely", "simple-email", "templates", { limit }]` | `useTemplates` |
| `["pilely", "simple-email", "template", templateId]` | `useTemplate` |

## Templates can be nameless, and can lose their body

`name` is `string | null`: a nameless template is legal. `html` on `useTemplate`'s data is optional, not nullable — when the stored body is missing the service omits the key. Check `"html" in template` before rendering it.

## Mock mode

Importing this package in a build made with `VITE_PILELY_MOCK=1` registers an in-browser fake of `simple_email` behind `@pilely/core`'s mock runtime — nothing else to call.

**Nothing is ever sent.** A send is appended to an in-memory outbox — the rows `useSends` answers — and logged to the console. Accounts and templates persist to `localStorage` across reloads; the app's account is created on its first send. A missing account or template answers the bare 404, and a second account for the same app answers `account_exists` (409). The 50-recipient bound is kept. It does not model send groups, the daily cap, the phone gate, rate limits or credit checks.

Writes need a signed-in user: a signed-out write answers the uniform bare 404, which reaches the hook's `error` as `PilelyError(404, null)`. See [`@pilely/core`](../core#mock-mode) for the switch, `seedMock()` and `resetMock()`.

## Error codes

Refusals arrive as `PilelyError` in the hook's `error`, with a `code` drawn from `SimpleEmailErrorCode`. Match on the code: **`daily_cap_exceeded` and `rate_limited` both answer 429** — one means the app spent its UTC-day allowance (retry tomorrow), the other is a burst window (retry shortly).

A send can also answer `phone_verification_required` (403), `phone_verification_unavailable` (503) and `out_of_traffic_credits` (503). Provisioning adds `account_exists`, `account_limit_reached` and `template_limit_reached` (all 409). The rest: `not_found` (404, the uniform hide), `bad_request` (400), `unauthenticated` (401), `bad_forwarded_identity` (401), `internal` (500). An oversize send or template body is refused before any handler runs, so its `code` is `null`.

Limits: billed per recipient, at most 50 recipients per send, 200 sends per app per UTC day.

## Install

```sh
npm install @pilely/simple-email @pilely/core @tanstack/react-query
```

`@pilely/core`, `react` (`^18.3 || ^19`) and `@tanstack/react-query` (`^5`) are peer dependencies. Always install with the scope — unscoped names like `pilely-email` are not owned by this project. This is a pre-1.0 package and moves with the platform.
