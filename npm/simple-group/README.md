# `@pilely/simple-group`

A typed client for the `simple_group` service — the platform's managed
group membership and delegated permissions. Wraps all 13 of its POST
routes.

## Install

```sh
npm install @pilely/simple-group @pilely/core
```

Always install with the scope — `pilely-group` and similar unscoped names
are not owned by this project and are squattable. `@pilely/core` is a peer
dependency; an app has exactly one facade, never two.

## Three cursor shapes, not one

This service pages three different ways, and this package types each one
separately rather than forcing a single generic cursor onto all of them:

- `listGroups` / `listAllGroups` page on `{ after_created_time_stamp,
  after_group_nanoid }`.
- `listMembers` / `listPermissions` (and their `listAll*` walks) page on the
  `{ after_created_time_stamp, after_subject_type, after_subject_id }`
  triple.
- `searchMembers` / `searchAllMembers` page on `{ after_label }` alone.

Every `listAll*`/`searchAllMembers` walk sends `limit: 100` on every page —
the server's own page cap — so it never silently doubles round-trips the
way an omitted `limit` (which defaults to 50) would.

## Status

This is a pre-1.0 package and moves with the platform. Nothing here is
published to the registry yet. Zero runtime dependencies.

## Deleted subjects send a null label

`label` is the subject's handle, enriched at read time. A member or
permission row **survives its subject**: when the account or app behind it
is deleted, the row stays and `label` comes back `null`. Both `Member.label`
and `Permission.label` are typed `string | null` for that reason — reaching
through one without a check throws on exactly the rows you did not create in
testing.

```ts
const shown = member.label ?? "(deleted account)";
```

## Error codes

Refusals arrive as `PilelyError` with a `code` drawn from
`SimpleGroupErrorCode`. Match on the code, never on the status.

`create`, `addMember` and `addPermission` can answer two that the others
cannot: `storage_exceeded` (402, the owner's allowance is full — the owner
must act, a retry cannot help) and `quota_unavailable` (503, the allowance
could not be read — transient, retry is fine).

The rest: `not_found` (404, the uniform hide), `group_archived` (409),
`unknown_subject` (400), `limit_reached` (409), `bad_request` (400),
`unauthenticated` (401), `bad_forwarded_identity` (401),
`out_of_traffic_credits` (503), `rate_limited` (429), `internal` (500).

Removing yourself from a group always succeeds, whether or not you were a
member — do not read a success as proof you were one.
