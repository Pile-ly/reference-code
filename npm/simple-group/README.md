# `@pilely/simple-group`

React hooks for the `simple_group` service — the platform's managed group membership and delegated permissions, and the exact handle-to-user-id lookup. A query hook for every read, a mutation hook for every write. Render them inside `@pilely/core`'s `<PilelyProvider>`.

## Hooks

| Hook | Wraps | Kind |
| --- | --- | --- |
| `useGroups({ limit? })` | `groups/list`, paged | infinite query; `data` is `GroupWithMemberCount[]` |
| `useMembers(group, { limit? })` | `members/list`, paged | infinite query; `data` is `Member[]` |
| `useMemberSearch(group, q, { limit? })` | `members/search`, paged | infinite query; label-prefix search among user members |
| `useMembership(group, subject)` | `members/resolve` | query; `data` is `boolean` |
| `usePermissions(group, action, { limit? })` | `members/{action}/permission/list`, paged | infinite query; `data` is `Permission[]` |
| `useHandleLookup(handle)` | `users/lookup` | query; `data` is `{ user_id, handle }` |
| `useCreateGroup()` | `groups/create` | mutation, the optional display name, or `{ displayName?, membersCanList? }` |
| `useRenameGroup()` | `groups/{g}/rename` | mutation, `{ group, displayName? }` |
| `useSetMembersCanList()` | `groups/{g}/set_members_can_list` | mutation, `{ group, membersCanList }`; owner only |
| `useArchiveGroup()` | `groups/{g}/archive` | mutation, the group's nanoid |
| `useUnarchiveGroup()` | `groups/{g}/unarchive` | mutation, the group's nanoid |
| `useAddMember()` | `members/add` | mutation, `{ group, subject }` |
| `useRemoveMember()` | `members/remove` | mutation, `{ group, subject }` |
| `useAddPermission()` | `members/{action}/permission/add` | mutation, `{ group, action, subject }` |
| `useRemovePermission()` | `members/{action}/permission/remove` | mutation, `{ group, action, subject }` |

An `undefined` group, `q`, `subject`, `action` or `handle` disables the read that takes it. `subject` is `{ subject_type: "user" | "app", subject_id }`; `action` is one of `add`, `remove`, `list`, `search`, `resolve`. Every write waits for the server.

There is no cap on how many groups an owner has (archived ones included) or how many members a group holds; storage is the only brake (`storage_exceeded`). Page through `useGroups` and `useMembers` until `hasNextPage` is `false` to see every row.

Every `Group` carries `members_can_list` (default `false`). While the owner has it on, every **user** member may page `useMembers` for that group, with no grant; it widens nothing else (`useMemberSearch` and `useMembership` still need their grants). Turning it off, or removing the member, stops their listing on their next request. A member listing an archived group gets `group_archived`.

A permission grant names a user. `useAddPermission` with an `app` subject is refused with `app_grant_unsupported` (400), before the group is looked up, and stores nothing. `app` grants made before that refusal still show in `usePermissions` and can be removed; they authorize nothing.

## Which hooks work from an app page

Every hook calls `simple_group` with the token `@pilely/core` holds, which in an app's page is that app's token. `simple_group` changes a group only for a person signed in with a token for `simple-group` itself: a group records no app and may guard the resources of several of the owner's apps, so no app's page may change one (`https://simple-group.pilely.app/README.md` → `## Auth`).

- **Read hooks work from any app's page**, under the group rules above: `useGroups`, `useMembers`, `useMemberSearch`, `useMembership`, `usePermissions`, `useHandleLookup`.
- **Write hooks are refused from every app's page**: `useCreateGroup`, `useRenameGroup`, `useSetMembersCanList`, `useArchiveGroup`, `useUnarchiveGroup`, `useAddMember`, `useRemoveMember`, `useAddPermission`, `useRemovePermission` (a member removing themselves included). Each gets the uniform hide, `not_found` (404), in its `error`, and nothing changes. The owner makes group changes from their agent, acting on `simple_group` directly. Build an app's admin screen to read groups and look people up, and leave the changes to the owner's agent.

## Find a person by handle

Member and grant routes take a user id, never a handle. `useHandleLookup(handle)` turns an exact handle into the account's id: the server trims it, drops one leading `@` and lower-cases it, and only an exact match answers (`ali` never finds `alice`). A handle no account holds — never registered, reserved, or released by a deleted account — is an `error` with code `not_found` (404). Any signed-in user may look up; each lookup is a metered request billed to the caller.

```tsx
const { data: person, error } = useHandleLookup(handle || undefined);
// once person is set, show person.user_id; the owner's agent adds it to the group
```

## What each write refreshes

| Write | Invalidates |
| --- | --- |
| group create / rename / set members_can_list / archive / unarchive | `useGroups()` |
| member or permission add / remove on group `G` | `G`'s members, searches, membership checks and permissions; `useGroups()` (member counts) |

## Example

An app page reads; it never changes a group (`## Which hooks work from an app page`).

```tsx
import { useGroups, useMembers } from "@pilely/simple-group";

export function Team({ group }: { group: string | undefined }) {
  const { data: groups } = useGroups();
  const { data: members } = useMembers(group);

  return (
    <>
      <ul>{groups?.map((g) => <li key={g.group_nanoid}>{g.display_name} ({g.member_count})</li>)}</ul>
      <ul>{members?.map((m) => <li key={m.subject_id}>{m.label ?? "(deleted account)"}</li>)}</ul>
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
| `["pilely", "simple-group", "lookup", handle]` | `useHandleLookup` |

## Deleted subjects send a null label

`label` is the subject's handle, filled in at read time. A member or permission row survives its subject: when the account or app behind it is deleted, `label` comes back `null`. Always render a fallback, as the example does.

## Mock mode

Importing this package in a build made with `VITE_PILELY_MOCK=1` registers an in-browser fake of `simple_group` behind `@pilely/core`'s mock runtime — nothing else to call.

The fake keeps groups, members and permission grants, persisted to `localStorage` across reloads, paged on the service's cursors. A missing group answers the bare 404, and an archived group refuses writes with `group_archived` (409). A subject's `label` is its id; the mock user's is its handle. It does not model most permission rules — every signed-in user may run most routes on every group, and the write hooks succeed even though the service refuses them from an app page — storage walls, quotas or traffic credits, and like the service it has no group or member cap. It does model the rules this package's contract turns on:

- the group's creator owns it, and only the owner may `set_members_can_list` (anyone else gets the bare 404);
- `members/list` answers the owner, a `list` grant holder, and a user member while `members_can_list` is on; anyone else gets the bare 404, and a non-owner on an archived group gets `group_archived`;
- `permission/add` refuses an `app` subject with `app_grant_unsupported`;
- `users/lookup` matches exactly over the mock's one account, the mock user (`mock_user`): a miss throws `PilelyError(404, "not_found")`, and a signed-out lookup `PilelyError(401, "unauthenticated")`.

Writes need a signed-in user: a signed-out write answers the uniform bare 404, which reaches the hook's `error` as `PilelyError(404, null)`. See [`@pilely/core`](../core#mock-mode) for the switch, `seedMock()` and `resetMock()`.

## Error codes

Refusals arrive as `PilelyError` in the hook's `error`, with a `code` drawn from `SimpleGroupErrorCode`. Match on the code, never on the status.

From an app's page a write hook gets only `not_found` (404), and nothing further is checked (`## Which hooks work from an app page`); the write codes below reach a person acting on `simple_group` directly. Group create, member add and permission add can answer `storage_exceeded` (402, the owner's allowance is full — the owner must act) and `quota_unavailable` (503, transient). Permission add alone can answer `limit_reached` (409, the 200-grants-per-action cap — groups and members have no cap) and `app_grant_unsupported` (400, an `app` subject). The rest: `not_found` (404, the uniform hide; on a handle lookup, no account holds that handle), `group_archived` (409), `unknown_subject` (400), `bad_request` (400), `unauthenticated` (401), `bad_forwarded_identity` (401), `out_of_traffic_credits` (503), `rate_limited` (429, reserved — the service sets no rate limit and `@simple_limiter` accepts no policy on its host, so nothing answers it today), `internal` (500).

Removing yourself from a group, on `simple_group` directly, always succeeds, whether or not you were a member.

## Install

```sh
npm install @pilely/simple-group @pilely/core @tanstack/react-query
```

`@pilely/core`, `react` (`^18.3 || ^19`) and `@tanstack/react-query` (`^5`) are peer dependencies. Always install with the scope — unscoped names like `pilely-group` are not owned by this project. This is a pre-1.0 package and moves with the platform.
