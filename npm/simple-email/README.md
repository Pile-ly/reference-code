# `@pilely/simple-email`

React hooks for the `simple_email` service — the platform's managed transactional email. A query hook for every read, a mutation hook for every write. Render them inside `@pilely/core`'s `<PilelyProvider>`.

## Hooks

| Hook | Wraps | Kind |
| --- | --- | --- |
| `useSend()` | `/send` | mutation, `{ to, subject, html }` or `{ to, template_id, variables? }` (a raw send), or `{ to_account, template_id, variables? }` (an account send); each takes an optional `idempotency_key`. Answers `{ send_id, recipient_count, replayed }` |
| `useSends({ limit? })` | `/sends/list`, paged | infinite query; this app's outbox, `SendRow[]` |
| `useEmailAccount()` | `accounts/{app}/info` | query; this app's account with its daily cap, sent today, credit and phone state |
| `useEmailAccounts({ limit? })` | `accounts/list`, paged | infinite query; every account the caller owns |
| `useCreateEmailAccount()` | `accounts/create` | mutation, the optional send group, or `{ send_group?, account_senders? }` |
| `useDeleteEmailAccount()` | `accounts/{app}/delete` | mutation, no variables |
| `useSetEmailAccountAccess()` | `accounts/{app}/access/set` | mutation, the send group (`null` = owner-only), or `{ send_group, account_senders? }` (an omitted `account_senders` keeps the current value) |
| `useTemplates({ limit? })` | `templates/list`, paged | infinite query; metadata only |
| `useTemplate(templateId)` | `templates/{t}/info` | query; the template with its `html`; an `undefined` id disables it |
| `useCreateTemplate()` | `templates/create` | mutation, `{ name, subject, html }` (`name` may be `null`) |
| `useUpdateTemplate()` | `templates/{t}/update` | mutation, `{ templateId, subject, html }` — a full replace |
| `useDeleteTemplate()` | `templates/{t}/delete` | mutation, the template id |

The app id is added from `@pilely/core` on every route; it is never a variable. Every write waits for the server: an email "sent" before the server accepted it would be a lie.

## Raw sends and account sends

A **raw send** (`to`) goes to the addresses you name, with template or inline content. An **account send** (`to_account`) sends a template to one address the service looks up itself: the caller's own Pilely account email (`"self"`) or the app owner's (`"owner"`). The caller never supplies or sees that address — not in the answer, and not on the `"self"` row of the owner's `useSends()` (its `recipients` is `[]`). An account send is template-only: `to` with `to_account`, or `subject` / `html` on an account send, does not typecheck. It counts 1 recipient toward the daily cap and is billed to the owner like any other send.

Who may make account sends is the account's `account_senders`: `"send_group"` (the default — the owner and the send group's members) or `"app_users"` (also every signed-in user of the app, through the app; raw sends stay closed to them). When you choose `"app_users"`, add a per-user `@simple_limiter` policy on `simple-email.<endpoint>` `/send` — without it one user can use up the app's daily cap and spend your balance. The service README's `### Who can send from an account` has the full table.

## Retries: `idempotency_key`

Give a send an `idempotency_key` (1–128 characters of `[A-Za-z0-9._:-]`, held per app for 24 hours) and a repeat with the same key, the same body and the same caller answers the FIRST send's `send_id` with `replayed: true` — nothing is sent, billed or counted again. The same key with another body or from another caller is `idempotency_key_reused` (409); a repeat while the first is still being handed to the provider is `idempotency_key_in_progress` (409, retry in a few seconds). Pick keys stable per logical email — `confirm:<row id>`, `digest:<user id>:<YYYY-MM-DD>` — so a retry after a crash or a timeout repeats the same key. Without a key every request is a new send, and `replayed` is `false`.

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
      <ul>
        {sends?.map((row) => (
          <li key={row.send_id}>
            {row.subject} — {row.outcome}
            {row.to_account && ` (to the ${row.to_account} account email)`}
          </li>
        ))}
      </ul>
    </>
  );
}

// After a row is stored: confirm it to the signed-in submitter, once, even if
// the page retries. `templateId` is a template of this app's account.
export function useConfirmSubmission(templateId: string) {
  const send = useSend();
  return (rowId: string) =>
    send.mutateAsync({ to_account: "self", template_id: templateId, idempotency_key: `confirm:${rowId}` });
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

**Nothing is ever sent.** A send is appended to an in-memory outbox — the rows `useSends` answers — and logged to the console. Accounts and templates persist to `localStorage` across reloads; the app's account is created on its first send. A missing account or template answers the bare 404, and a second account for the same app answers `account_exists` (409). The 50-recipient bound is kept.

It models the send shapes and `idempotency_key`: an account send's row carries `to_account` and one recipient (`recipients: []` for `"self"`, a stand-in owner address for `"owner"` — the fake has no real account emails); a body with both `to` and `to_account`, or an account send with inline content, is `bad_request`; a repeat with the same key, body and caller answers `replayed: true` without a new row, and the same key with another body is `idempotency_key_reused`. Accounts carry `account_senders`, settable on create and access/set. It does not model send groups, `account_senders` gating, the daily cap, the phone gate, rate limits, credit checks or `idempotency_key_in_progress`.

Writes need a signed-in user: a signed-out write answers the uniform bare 404, which reaches the hook's `error` as `PilelyError(404, null)`. See [`@pilely/core`](../core#mock-mode) for the switch, `seedMock()` and `resetMock()`.

## Error codes

Refusals arrive as `PilelyError` in the hook's `error`, with a `code` drawn from `SimpleEmailErrorCode`. Match on the code, not the status: **`out_of_traffic_credits` and `phone_verification_unavailable` both answer 503** — one means the owner's traffic balance is used up (the owner must top up), the other is transient (retry shortly). `daily_cap_exceeded` (429) means the app spent its UTC-day allowance (retry tomorrow). `rate_limited` (429) means the caller is over a `@simple_limiter` policy the app's owner set on this app's sends; root answers it with a `Retry-After` header (retry after that many seconds). `idempotency_key_reused` (409) means the key already belongs to a different request on this app in the last 24 hours — nothing was sent, use a new key for a different email; `idempotency_key_in_progress` (409) means the first request with that key is still being handed to the provider — retry in a few seconds with the same key.

A send can also answer `phone_verification_required` (403), `phone_verification_unavailable` (503) and `out_of_traffic_credits` (503). Provisioning adds `account_exists`, `account_limit_reached` and `template_limit_reached` (all 409). The rest: `not_found` (404, the uniform hide), `bad_request` (400), `unauthenticated` (401), `bad_forwarded_identity` (401), `internal` (500). An oversize send or template body is refused before any handler runs, so its `code` is `null`.

Limits: billed per recipient, at most 50 recipients per send (an account send has exactly 1), 200 recipients per app per UTC day by default. `useEmailAccount()`'s `daily_cap` shows the cap in force for this app; for a higher one, open a support ticket on `@customer` naming the app, the cap you want and what the mail is.

## Install

```sh
npm install @pilely/simple-email @pilely/core @tanstack/react-query
```

`@pilely/core`, `react` (`^18.3 || ^19`) and `@tanstack/react-query` (`^5`) are peer dependencies. Always install with the scope — unscoped names like `pilely-email` are not owned by this project. This is a pre-1.0 package and moves with the platform.
