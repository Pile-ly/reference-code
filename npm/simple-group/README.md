# `@pilely/simple-group`

React hooks for the `simple_group` service — the platform's managed group membership and delegated permissions. A query hook for every read, a mutation hook for every write. Render them inside `@pilely/core`'s `<PilelyProvider>`.

## Hooks

| Hook | Wraps | Kind |
| --- | --- | --- |
| `useGroups({ limit? })` | `groups/list`, paged | infinite query; `data` is `GroupWithMemberCount[]` |
| `useMembers(group, { limit? })` | `members/list`, paged | infinite query; `data` is `Member[]` |
| `useMemberSearch(group, q, { limit? })` | `members/search`, paged | infinite query; label-prefix search among user members |
| `useMembership(group, subject)` | `members/resolve` | query; `data` is `boolean` |
| `usePermissions(group, action, { limit? })` | `members/{action}/permission/list`, paged | infinite query; `data` is `Permission[]` |
| `useCreateGroup()` | `groups/create` | mutation, the optional display name |
| `useRenameGroup()` | `groups/{g}/rename` | mutation, `{ group, displayName? }` |
| `useArchiveGroup()` | `groups/{g}/archive` | mutation, the group's nanoid |
| `useUnarchiveGroup()` | `groups/{g}/unarchive` | mutation, the group's nanoid |
| `useAddMember()` | `members/add` | mutation, `{ group, subject }` |
| `useRemoveMember()` | `members/remove` | mutation, `{ group, subject }` |
| `useAddPermission()` | `members/{action}/permission/add` | mutation, `{ group, action, subject }` |
| `useRemovePermission()` | `members/{action}/permission/remove` | mutation, `{ group, action, subject }` |

An `undefined` group, `q`, `subject` or `action` disables the read that takes it. `subject` is `{ subject_type: "user" | "app", subject_id }`; `action` is one of `add`, `remove`, `list`, `search`, `resolve`. Every write waits for the server.

## What each write refreshes

| Write | Invalidates |
| --- | --- |
| group create / rename / archive / unarchive | `useGroups()` |
| member or permission add / remove on group `G` | `G`'s members, searches, membership checks and permissions; `useGroups()` (member counts) |

## Example

```tsx
import { useAddMember, useCreateGroup, useGroups, useMembers } from "@pilely/simple-group";

export function Team({ group }: { group: string | undefined }) {
  const { data: groups } = useGroups();
  const { data: members } = useMembers(group);
  const createGroup = useCreateGroup();
  const addMember = useAddMember();

  return (
    <>
      <button onClick={() => createGroup.mutate("Editors")}>New group</button>
      <ul>{groups?.map((g) => <li key={g.group_nanoid}>{g.display_name} ({g.member_count})</li>)}</ul>
      <ul>{members?.map((m) => <li key={m.subject_id}>{m.label ?? "(deleted account)"}</li>)}</ul>
      {group && (
        <button onClick={() => addMember.mutate({ group, subject: { subject_type: "user", subject_id: "u-123" } })}>
          Add member
        </button>
      )}
    </>
  );
}
```

## Query keys

| Key | Query |
| --- | --- |
| `["pilely", "simple-group", "groups", { limit }]` | `useGroups` |
| `["pilely", "simple-group", "group", group, "members", { limit }]` | `useMembers` |
| `["pilely", "simple-group", "group", group, "search", q, { limit }]` | `useMemberSearch` |
| `["pilely", "simple-group", "group", group, "resolve", subject_type, subject_id]` | `useMembership` |
| `["pilely", "simple-group", "group", group, "permissions", action, { limit }]` | `usePermissions` |

## Deleted subjects send a null label

`label` is the subject's handle, filled in at read time. A member or permission row survives its subject: when the account or app behind it is deleted, `label` comes back `null`. Always render a fallback, as the example does.

## Mock mode

Importing this package in a build made with `VITE_PILELY_MOCK=1` registers an in-browser fake of `simple_group` behind `@pilely/core`'s mock runtime — nothing else to call.

The fake keeps groups, members and permission grants, persisted to `localStorage` across reloads, paged on the service's cursors. A missing group answers the bare 404, and an archived group refuses writes with `group_archived` (409). A subject's `label` is its id; the mock user's is its handle. It does not model the permission rules — every signed-in user may run every route on every group — caps, storage walls, quotas or traffic credits.

Writes need a signed-in user: a signed-out write answers the uniform bare 404, which reaches the hook's `error` as `PilelyError(404, null)`. See [`@pilely/core`](../core#mock-mode) for the switch, `seedMock()` and `resetMock()`.

## Error codes

Refusals arrive as `PilelyError` in the hook's `error`, with a `code` drawn from `SimpleGroupErrorCode`. Match on the code, never on the status.

Group create, member add and permission add can answer `storage_exceeded` (402, the owner's allowance is full — the owner must act) and `quota_unavailable` (503, transient). The rest: `not_found` (404, the uniform hide), `group_archived` (409), `unknown_subject` (400), `limit_reached` (409), `bad_request` (400), `unauthenticated` (401), `bad_forwarded_identity` (401), `out_of_traffic_credits` (503), `rate_limited` (429), `internal` (500).

Removing yourself from a group always succeeds, whether or not you were a member.

## Install

```sh
npm install @pilely/simple-group @pilely/core @tanstack/react-query
```

`@pilely/core`, `react` (`^18.3 || ^19`) and `@tanstack/react-query` (`^5`) are peer dependencies. Always install with the scope — unscoped names like `pilely-group` are not owned by this project. This is a pre-1.0 package and moves with the platform.
