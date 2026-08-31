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
