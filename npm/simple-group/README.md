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
