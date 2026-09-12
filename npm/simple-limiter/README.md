# `@pilely/simple-limiter`

A typed client for the `simple_limiter` service — user-defined rate-limit
policies enforced by root on the forward path. Wraps all three of its POST
routes.

## Install

```sh
npm install @pilely/simple-limiter @pilely/core
```

Always install with the scope — an unscoped name like `pilely-limiter` is
not owned by this project and is squattable. `@pilely/core` is a peer
dependency; an app has exactly one facade, never two.

## A policy is immutable

Create, list and disable are the whole lifecycle — there is no update, no
reset, no re-enable. Get a policy wrong and create a new one instead; the
disabled row stays forever as the audit record.

## Example: rate-limit a contact form on a simple_db table

```ts
import { createPolicy } from "@pilely/simple-limiter";

await createPolicy({
  name: "inquiry form",
  host: "simple-db.pilely.app",
  method: "POST",
  path: "/apps/<pile_id>/tables/inquiries/records/create",
  key: "ip",
  strategy: { type: "fixed_window", limit: 5, window_secs: 60 },
});
```

`key: "ip"` is deliberate here: the form is filled out by anonymous
visitors, and a `user` policy never counts an anonymous caller. Pick `key:
"user"` for a route only signed-in callers reach, and `key: "all"` for one
shared counter across every caller.

## Example: rate-limit a route on your own app host

```ts
import { createPolicy } from "@pilely/simple-limiter";

await createPolicy({
  name: "webhook receiver",
  host: "<your-label>.pilely.app",
  method: "POST",
  path: "/webhooks/**",
  key: "all",
  strategy: { type: "token_bucket", rate_per_sec: 2, burst: 10 },
});
```

`**` matches the rest of the path — every route under `/webhooks/` shares
one bucket.

## Listing and disabling

```ts
import { disablePolicy, listAllPolicies } from "@pilely/simple-limiter";

const mine = await listAllPolicies(); // newest first, disabled rows included
await disablePolicy(mine[0].id); // stops matching immediately; a second call 409s
```

`listPolicies`/`listAllPolicies` page on the `{ after_created_at, after_id
}` keyset — a shape private to this service, do not mix it with another
`simple_*` client's cursor type. Every `listAllPolicies` page sends `limit:
100` — an arbitrary walk page size this client chose, well under the
server's own `/policies/list` cap of 200 (its default page size, when no
`limit` is supplied at all, is 50).

## Status

This is a pre-1.0 package and moves with the platform. Nothing here is
published to the registry yet. Zero runtime dependencies.
