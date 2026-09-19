# `@pilely/simple-email`

A typed client for the `simple_email` service — the platform's managed
transactional email. Wraps all 12 of its POST routes: sending, account
provisioning, and templates.

## Install

```sh
npm install @pilely/simple-email @pilely/core
```

Always install with the scope — `pilely-email` and similar unscoped names
are not owned by this project and are squattable. `@pilely/core` is a peer
dependency; an app has exactly one facade, never two.

## Where the app id lives

Unlike the other three service packages, this one splits: `send()` and
`listSends()` put the app id in the request **body**; every account and
template method puts it in the request **path**. `listAccounts()` takes no
app id at all — it lists every account the caller owns. Every method adds
the id itself from `@pilely/core`'s `appId()`; it is never a parameter you
pass.

## Templates live under the account

There is no top-level `templates/...` route. Every template call is
`accounts/{app}/templates/...` — a template belongs to one account, and
`createTemplate`/`listTemplates`/`templateInfo`/`updateTemplate`/`deleteTemplate`
all reach it that way.

## Status

This is a pre-1.0 package and moves with the platform. Nothing here is
published to the registry yet. Zero runtime dependencies.

## Templates can be nameless, and can lose their body

Two degraded shapes the service keeps deliberately visible, both reflected
in the types:

- `name` is `string | null`. A nameless template is legal — `createTemplate`
  takes `string | null` and hands the `null` straight back.
- `html` is **optional, not nullable**. When the stored object behind a
  template is missing, `templateInfo` omits the key rather than sending
  `null`. Discriminate with `"html" in template`, and never assume a body.

## Error codes

Refusals arrive as `PilelyError` with a `code` drawn from
`SimpleEmailErrorCode`. Here matching on the code is not optional:

**`daily_cap_exceeded` and `rate_limited` both answer 429.** One means the
app has spent its UTC-day send allowance (retry tomorrow, or not at all);
the other is an ordinary burst window (retry shortly). The status cannot
tell them apart — only the code can.

`send` can also answer `phone_verification_required` (403) and
`phone_verification_unavailable` (503) from the phone gate, and
`out_of_traffic_credits` (503). Provisioning adds `account_exists`,
`account_limit_reached` and `template_limit_reached` (all 409). The
remainder: `not_found` (404, the uniform hide), `bad_request` (400),
`unauthenticated` (401), `bad_forwarded_identity` (401), `internal` (500).

A member-role caller sees a uniform 404 where the owner would see a 503
`out_of_traffic_credits` — worth knowing before debugging a member's send.

## Limits worth knowing before you call `send`

- Billed **per recipient**, not per call.
- At most 50 recipients per send.
- 200 sends per app per UTC day — the `daily_cap_exceeded` wall above.
- `send_id` is the idempotency key.
