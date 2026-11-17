# `@pilely/simple-email`

The client for the `simple_email` service — the platform's managed transactional email. An email account has two ways to send, and this package has one entry for each:

- **`sendTemplate(templateId, variables)`**, and its hook `useSendTemplate()`, for a **page** of the app: the **template send**. It sends one of the account's templates, filled from the variables, to the ONE address the owner stored on that template. The caller supplies only the variables, so it can never point the mail at anyone else or change what it says. Any caller the template's groups admit can make it — signed-out visitors included.
- **`send({ to, ... })`** for the app's **backend only**: the **freestyle send**, to any addresses, from a template or inline. Only the account's app's own backend, calling with its backend token, is admitted; a page, a signed-in user and you, the owner, get the uniform 404. It needs no browser runtime: a server imports it from `@pilely/simple-email/send`.

Beside them, a query hook for every read and a mutation hook for every write of the account and its templates, for owner tooling. Render the hooks inside `@pilely/core`'s `<PilelyProvider>`.

**Moving from `0.4.x`:** `0.5.0` removes `useSend()`, `useSends()` and `useSetEmailAccountAccess()` — the service no longer has the routes they call, so a `0.4.x` client's sends and outbox fail — and accounts carry no send access of their own any more: who may send is each template's groups, and your app's backend. Templates gain `recipient`, `send_group` and `deny_group`. `create-pilely-app` `0.4.3` still scaffolds `"@pilely/simple-email": "^0.4.0"`, whose `useSend` / `useSends` call those removed routes: in a scaffolded app, move the range to `^0.5.0`.

## Hooks and functions

| Export | Wraps | Kind |
| --- | --- | --- |
| `useSendTemplate()` | `accounts/{app}/templates/{t}/send` | mutation, `{ templateId, variables? }`; answers `{ send_id }`, never the address |
| `sendTemplate(templateId, variables?, { challenge }?)` | `accounts/{app}/templates/{t}/send` | the same template send as a plain function |
| `send(input, { appId, backendToken, origin? })` | `accounts/{app}/send` | the freestyle send, backend only; `input` is `{ to, subject, html }` or `{ to, template_id, variables? }`, each with an optional `idempotency_key`. Answers `{ send_id, recipient_count, replayed }` |
| `useEmailAccount()` | `accounts/{app}/info` | query; this app's account with its daily cap, sent today and credit state |
| `useEmailAccounts({ limit? })` | `accounts/list`, paged | infinite query; every account the caller owns |
| `useCreateEmailAccount()` | `accounts/create` | mutation, no variables, or `{ reply_to? }` |
| `useDeleteEmailAccount()` | `accounts/{app}/delete` | mutation, no variables |
| `useSetEmailReplyTo()` | `accounts/{app}/set_reply_to` | mutation, the reply-to address, or `null` to clear it; always sent, never "keep" |
| `useTemplates({ limit? })` | `templates/list`, paged | infinite query; metadata only |
| `useTemplate(templateId)` | `templates/{t}/info` | query; the template with its `html`; an `undefined` id disables it |
| `useCreateTemplate()` | `templates/create` | mutation, `{ name, subject, html, recipient, send_group?, deny_group? }` (`name` may be `null`; `recipient` is required) |
| `useUpdateTemplate()` | `templates/{t}/update` | mutation, `{ templateId, subject, html, recipient?, send_group?, deny_group? }` — `subject` and `html` a full replace; an omitted `recipient` or group keeps the stored value, `null` empties a group |
| `useDeleteTemplate()` | `templates/{t}/delete` | mutation, the template id |

On a page the app id is added from `@pilely/core` on every route; it is never a variable. `send()` runs where there is no page, so it takes the app id and the backend token explicitly. Every write waits for the server: an email "sent" before the server accepted it would be a lie.

Every template answer (`TemplateMeta`, `Template`) carries `recipient` (the stored address), `send_group` and `deny_group` (group ids, or `null` for an empty group). An `Account` carries `app_id`, `address`, `display_name`, `reply_to` and `created_time_stamp`.

## The template send, from a page

```tsx
import { useSendTemplate } from "@pilely/simple-email";

// CONTACT is a template of this app's account whose recipient is your own
// address and whose send_group admits the people who use this form.
export function ContactForm() {
  const sendTemplate = useSendTemplate();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        sendTemplate.mutate({
          templateId: CONTACT,
          variables: { name: String(form.get("name")), message: String(form.get("message")) },
        });
      }}
    >
      <input name="name" />
      <textarea name="message" />
      <button disabled={sendTemplate.isPending}>Send</button>
      {sendTemplate.isSuccess && <p>Thanks — your message was sent.</p>}
      {sendTemplate.error && <p role="alert">{sendTemplate.error.message}</p>}
    </form>
  );
}
```

`variables` holds one string per `{{placeholder}}` of the template's subject and html, and it is the whole request body: every other field the service ignores, so a caller can never add a `to`, a `subject` or an `html`. A missing (or non-string) variable is `bad_request` (400) and nothing is sent. The answer is `{ send_id }`; no answer of this route, success or error, carries the stored address. A template send counts 1 recipient toward the app's daily send cap.

**Who may send it is the template's two groups.** Through the app's own page, a caller is admitted exactly when it is a member of the template's `send_group` and not a member of its `deny_group`. A refused caller, an unknown template and an exhausted owner balance all get the same `not_found` (404). An empty `send_group` admits nobody: a template cannot be sent this way until you set one.

**Setting up the groups** with `@pilely/simple-group` (`https://simple-group.pilely.app/README.md`), then storing the ids on the template with `useCreateTemplate()` or `useUpdateTemplate()`:

- every signed-out visitor of a public app: `send_group` = the platform-wide anonymous group, from `anonymousGroupId()`;
- every signed-in user: `send_group` = the platform-wide authenticated group, from `authenticatedGroupId()`;
- chosen people, or your app's backend: an owner group of your own (`useCreateGroup()`), with them added as members;
- people to refuse: an owner group of your own as the `deny_group` (a platform-wide group is never a `deny_group`).

**Cap how often callers send it with a `@simple_limiter` policy** (`https://simple-limiter.pilely.app/README.md` → `### Limiting simple_email sends`): `host` `simple-email.pilely.app`, your app's id, `POST`, path `/accounts/<app id>/templates/*/send` (or one template's id in place of `*`), keyed by `ip` for signed-out visitors or `user` for signed-in users — for example a few sends per hour. Over it, root answers `rate_limited` (429) with a `Retry-After`. The service sets no per-caller limit of its own: without a policy, one caller can use up the app's daily cap and spend your balance. A template open to visitors is a form anyone can submit.

**You pay for every send.** Every send, template or freestyle, whoever caused it — a visitor, a signed-in user, your backend — is billed to the account's owner, never to the caller.

## The freestyle send, from your backend

```ts
import { send } from "@pilely/simple-email/send";

await send(
  { to: [row.email], template_id: WELCOME, variables: { name: row.name }, idempotency_key: `welcome:${row.id}` },
  { appId: APP_ID, backendToken: process.env.PILELY_BACKEND_TOKEN! },
);
```

`send()` is for a server that holds the app's backend token — **never call it from a page**: a page has no backend token, and the service answers every caller but the app's own backend with the uniform 404. It imports nothing at runtime (no `@pilely/core`, no React, no `window.pilely`) and makes one plain `fetch` to `https://simple-email.pilely.app/accounts/<appId>/send` with the token as `Authorization: Bearer`; pass `origin` for another host. It is also exported from the main entry. A `@simple_server` box runs Rust, not JavaScript: there, make the same `POST` with your HTTP client (`https://simple-email.pilely.app/README.md` → `### POST /accounts/{app_id}/send`).

`to` holds 1 to 50 addresses; the content is a template (`template_id`, with `variables` matching its placeholders exactly) or inline (`subject` + `html`), never both. A refusal throws `SendError` with `status`, `code` (a `SimpleEmailErrorCode`, or `null` for a bodiless answer) and `reason`; it never carries the token.

Who may cause a freestyle send is your backend's own code — no group is involved. So is how often it sends: no `@simple_limiter` policy counts your app's backend, and the service's only bound is the freestyle cap, 500 recipients per app per UTC day (`daily_cap_exceeded`, 429), counted apart from the daily send cap. Before mailing an address a visitor typed, send at most one fixed-template confirmation with an `idempotency_key` tied to that address's row.

### Retries: `idempotency_key`

Give a freestyle send an `idempotency_key` (1–128 characters of `[A-Za-z0-9._:-]`, held per app for 24 hours) and a repeat with the same key and the same body answers the FIRST send's `send_id` with `replayed: true` — nothing is sent, billed or counted again. The same key with another body is `idempotency_key_reused` (409); a repeat while the first is still being handed to the provider is `idempotency_key_in_progress` (409, retry in a few seconds). Pick keys stable per logical email — `confirm:<row id>`, `digest:<user id>:<YYYY-MM-DD>` — so a retry after a crash or a timeout repeats the same key. Without a key every request is a new send, and `replayed` is `false`. The template send takes no key: every accepted call is a new email.

## Bot checks: `{ challenge }`

The app's owner can put a **challenge policy** on any route of `simple-email.pilely.app` for the app, typically the template send's path `/accounts/<app id>/templates/*/send` (`https://simple-limiter.pilely.app/README.md`) — never the freestyle send's `/accounts/<app id>/send`, whose backend caller cannot solve one, so such a policy would refuse every backend send; root then refuses every matching call through the app that carries no solved bot check with `403 challenge_required`, before the service sees it. Every hook and `sendTemplate` take a `challenge` option for that, in its options object or as its last argument where it has none (`useSendTemplate({ challenge })`, `useTemplate(templateId, { challenge })`):

```tsx
import { getChallenge, solveChallenge } from "@pilely/simple-limiter";

const sendTemplate = useSendTemplate({ challenge: async () => solveChallenge(await getChallenge()) });
await sendTemplate.mutateAsync({ templateId, variables }); // a fresh answer per send
```

A string, or a function answering one (it may be async, and may answer `undefined`) asked once for each request the hook sends; every request carries it as the `X-Pilely-Challenge` header, and root uses it up only on a call a policy matches. One answer works for one call, within 5 minutes of `getChallenge()`, so give a function to a hook that sends more than once. A refusal is a `PilelyError` with `challenge_required` or `challenge_failed` (both 403) and is never retried; get and solve a new one to start over. `send()` takes no `challenge`: a challenge is solved in a browser.

## Replies: `reply_to`

An account's `reply_to` is the address recipients' replies go to: every send from the account — template and freestyle — carries it as its `Reply-To`. `null` (the default) means none, and replies go nowhere. Set it on create (`useCreateEmailAccount()`'s `{ reply_to }`) or later with `useSetEmailReplyTo()`, which takes the address or `null` to clear it. It must be one bare address (no display name, no list) and not on `pilely-app-email.com`, `pilely.ai` or `pilely.app` nor a subdomain of one; the server answers anything else `bad_request` (400) with a reason naming the rule. Every `Account` carries it.

## What each write refreshes

| Write | Invalidates |
| --- | --- |
| template send | `useEmailAccount()` (its `sent_today`) |
| account create / set reply-to | `useEmailAccounts()`, `useEmailAccount()` |
| account delete | `useEmailAccounts()`, `useEmailAccount()`, and the templates under it |
| template create | `useTemplates()` |
| template update / delete on `t` | `useTemplates()`, `useTemplate(t)` |

`send()` is not a hook and touches no cache.

## Query keys

| Key | Query |
| --- | --- |
| `["pilely", "simple-email", "account"]` | `useEmailAccount` |
| `["pilely", "simple-email", "accounts", { limit }]` | `useEmailAccounts` |
| `["pilely", "simple-email", "templates", { limit }]` | `useTemplates` |
| `["pilely", "simple-email", "template", templateId]` | `useTemplate` |

## Templates can be nameless, and can lose their body

`name` is `string | null`: a nameless template is legal. `html` on `useTemplate`'s data is optional, not nullable — when the stored body is missing the service omits the key. Check `"html" in template` before rendering it.

## Mock mode

Importing this package in a build made with `VITE_PILELY_MOCK=1` registers an in-browser fake of `simple_email` behind `@pilely/core`'s mock runtime — nothing else to call.

**Nothing is ever sent.** A template send is appended to an in-memory outbox, addressed to the template's stored recipient, and logged to the console; its answer is `{ send_id }`, never the address. `useEmailAccount()`'s `sent_today` counts those sends. Accounts and templates persist to `localStorage` across reloads. A missing account or template answers the bare 404, and a second account for the same app answers `account_exists` (409).

The template send admits callers by the template's groups as the `@pilely/simple-db` fake admits by policies: the two platform-wide groups hold callers by type — every signed-out visitor is in the anonymous group, every signed-in person in the authenticated group — under the same fixed test ids `@pilely/simple-group`'s fake answers from `anonymousGroupId()` / `authenticatedGroupId()`. The fake has no group membership data, so **any other group holds nobody**: an owner group as `send_group` admits no one and a `deny_group` denies no one — test those against the real service. An empty `send_group` admits nobody. Each placeholder is read from the variables; a missing or non-string one is `bad_request`, and every other field is ignored.

The freestyle route answers the bare 404 to every caller, since no caller in a browser is the app's backend. `send()` never reaches the fake: it is a server function that calls `fetch` directly.

Templates carry `recipient` (required on create; `null` on update is `bad_request`), `send_group` and `deny_group` (a platform-wide group as `deny_group` is `bad_request`); accounts carry `reply_to`, settable on create and set_reply_to (a missing key or a non-string value on set_reply_to is `bad_request`). The fake checks the fields' shapes, not the address rules, refused domains or group ownership. It does not model the daily caps, rate limits or credit checks.

Owner writes need a signed-in user: a signed-out write answers the uniform bare 404, which reaches the hook's `error` as `PilelyError(404, null)`. See [`@pilely/core`](../core#mock-mode) for the switch, `seedMock()` and `resetMock()`.

## Error codes

Refusals arrive as `PilelyError` in the hook's `error` (as `SendError` from `send()`), with a `code` drawn from `SimpleEmailErrorCode`. Match on the code, not the status: **`daily_cap_exceeded` and `rate_limited` both answer 429**. `daily_cap_exceeded` means the app spent a UTC-day allowance (retry tomorrow): the daily send cap on a template send, the 500-recipient freestyle cap on `send()`. `rate_limited` means the caller is over a `@simple_limiter` policy the app's owner set on the template send; root answers it with a `Retry-After` header (retry after that many seconds). `idempotency_key_reused` (409) means the key already belongs to a different request on this app in the last 24 hours — nothing was sent, use a new key for a different email; `idempotency_key_in_progress` (409) means the first request with that key is still being handed to the provider — retry in a few seconds with the same key.

Both send routes answer an exhausted owner balance with the uniform `not_found` (404), so billing state never leaks to a caller; the owner routes answer it `out_of_traffic_credits` (503) — top up. Provisioning adds `account_exists`, `account_limit_reached` and `template_limit_reached` (all 409). The rest: `not_found` (404, the uniform hide), `bad_request` (400), `unauthenticated` (401), `bad_forwarded_identity` (401), `internal` (500).

A route the app's owner put a challenge policy on (`## Bot checks: { challenge }`) answers two more, from root before the service: `challenge_required` (403, the call carried no `challenge`; nothing was sent) and `challenge_failed` (403, the `challenge` was malformed, wrong, expired, started through another app, or already used — get and solve a new one). An oversize send or template body is refused before any handler runs, so its `code` is `null`.

Limits: billed per recipient. A template send has exactly 1 recipient and counts toward the daily send cap, 200 recipients per app per UTC day by default; `useEmailAccount()`'s `daily_cap` shows the cap in force for this app — for a higher one, open a support ticket on `@customer` naming the app, the cap you want and what the mail is. A freestyle send has 1 to 50 recipients and counts toward the freestyle cap, 500 recipients per app per UTC day, never the daily send cap.

## Install

```sh
npm install @pilely/simple-email @pilely/core @tanstack/react-query
```

`@pilely/core`, `react` (`^18.3 || ^19`) and `@tanstack/react-query` (`^5`) are peer dependencies of the main entry; the `@pilely/simple-email/send` subpath loads none of them. Always install with the scope — unscoped names like `pilely-email` are not owned by this project. This is a pre-1.0 package and moves with the platform.
