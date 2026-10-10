// The simple_group service's 15 POST routes, one function each. This is the
// internal layer the hooks in hooks.ts call; the package exports the hooks,
// not these.

import { call, collectPages, isMockMode, registerMockService } from "@pilely/core";

import { createSimpleGroupFake } from "./mock.js";
import type {
  Group,
  GroupAction,
  GroupCursor,
  GroupWithMemberCount,
  HandleLookup,
  LabelCursor,
  Member,
  Permission,
  Subject,
  SubjectCursor,
  SubjectType,
} from "./types.js";

// Importing this package (its hooks import this module) is all an app does
// to get its fake in mock mode. Dead code in a build without
// `VITE_PILELY_MOCK=1`, fake included.
if (isMockMode()) {
  registerMockService("simple-group", createSimpleGroupFake);
}

const MEMBER_ACTIONS: readonly GroupAction[] = ["add", "remove", "list", "search", "resolve"];

/** `[action]` is validated client-side too: an invalid value is a uniform
 *  404 from the server, and failing fast here saves the round trip. The
 *  admin pseudo-action is deliberately not part of this union — it is
 *  never delegable. */
function assertGroupAction(action: GroupAction): void {
  if (!MEMBER_ACTIONS.includes(action)) {
    throw new Error(`invalid group action "${action}"`);
  }
}

export interface CreateGroupOptions {
  /** Let every user member page `members/list`. The server defaults it to
   *  `false`; leaving it unset sends nothing. */
  members_can_list?: boolean;
}

export interface ListGroupsOptions {
  limit?: number;
  after_created_time_stamp?: number;
  after_group_nanoid?: string;
}

export interface ListMembersOptions {
  limit?: number;
  after_created_time_stamp?: number;
  after_subject_type?: SubjectType;
  after_subject_id?: string;
}

export interface SearchMembersOptions {
  limit?: number;
  after_label?: string;
}

// ── Group lifecycle ──────────────────────────────────────────────────────

export async function createGroup(displayName?: string, options: CreateGroupOptions = {}): Promise<Group> {
  const json = await call<{ group: Group }>({
    service: "simple-group",
    path: "/groups/create",
    body: { display_name: displayName, members_can_list: options.members_can_list },
  });
  return json.group;
}

/** The paged primitive — rows carry `member_count`, unlike every other
 *  group-shaped answer on this service. Use `listAllGroups` to walk to the
 *  end. */
export async function listGroups(
  options: ListGroupsOptions = {},
): Promise<{ groups: GroupWithMemberCount[]; next_cursor: GroupCursor | null }> {
  const json = await call<{ groups: GroupWithMemberCount[]; next_cursor: GroupCursor | null }>({
    service: "simple-group",
    path: "/groups/list",
    body: {
      limit: options.limit,
      after_created_time_stamp: options.after_created_time_stamp,
      after_group_nanoid: options.after_group_nanoid,
    },
  });
  return { groups: json.groups, next_cursor: json.next_cursor };
}

export async function listAllGroups(): Promise<GroupWithMemberCount[]> {
  return collectPages<GroupWithMemberCount, GroupCursor>(async (cursor) => {
    const page = await listGroups({ limit: 100, ...(cursor ?? {}) });
    return { rows: page.groups, nextCursor: page.next_cursor };
  });
}

export async function renameGroup(groupNanoid: string, displayName?: string): Promise<Group> {
  const json = await call<{ group: Group }>({
    service: "simple-group",
    path: `/groups/${groupNanoid}/rename`,
    body: { display_name: displayName },
  });
  return json.group;
}

/** Owner-only. While `value` is `true`, every user member may page
 *  `members/list` (it widens nothing else). Setting the value the group
 *  already has succeeds and changes nothing. */
export async function setMembersCanList(groupNanoid: string, value: boolean): Promise<Group> {
  const json = await call<{ group: Group }>({
    service: "simple-group",
    path: `/groups/${groupNanoid}/set_members_can_list`,
    body: { members_can_list: value },
  });
  return json.group;
}

export async function archiveGroup(groupNanoid: string): Promise<Group> {
  const json = await call<{ group: Group }>({
    service: "simple-group",
    path: `/groups/${groupNanoid}/archive`,
  });
  return json.group;
}

export async function unarchiveGroup(groupNanoid: string): Promise<Group> {
  const json = await call<{ group: Group }>({
    service: "simple-group",
    path: `/groups/${groupNanoid}/unarchive`,
  });
  return json.group;
}

// ── Members ───────────────────────────────────────────────────────────────

export async function addMember(groupNanoid: string, subject: Subject): Promise<void> {
  await call<{ ok: true }>({
    service: "simple-group",
    path: `/groups/${groupNanoid}/members/add`,
    body: { subject_type: subject.subject_type, subject_id: subject.subject_id },
  });
}

export async function removeMember(groupNanoid: string, subject: Subject): Promise<void> {
  await call<{ ok: true }>({
    service: "simple-group",
    path: `/groups/${groupNanoid}/members/remove`,
    body: { subject_type: subject.subject_type, subject_id: subject.subject_id },
  });
}

/** The paged primitive. Use `listAllMembers` to walk to the end. */
export async function listMembers(
  groupNanoid: string,
  options: ListMembersOptions = {},
): Promise<{ members: Member[]; next_cursor: SubjectCursor | null }> {
  const json = await call<{ members: Member[]; next_cursor: SubjectCursor | null }>({
    service: "simple-group",
    path: `/groups/${groupNanoid}/members/list`,
    body: {
      limit: options.limit,
      after_created_time_stamp: options.after_created_time_stamp,
      after_subject_type: options.after_subject_type,
      after_subject_id: options.after_subject_id,
    },
  });
  return { members: json.members, next_cursor: json.next_cursor };
}

export async function listAllMembers(groupNanoid: string): Promise<Member[]> {
  return collectPages<Member, SubjectCursor>(async (cursor) => {
    const page = await listMembers(groupNanoid, { limit: 100, ...(cursor ?? {}) });
    return { rows: page.members, nextCursor: page.next_cursor };
  });
}

/** Case-insensitive label-prefix search among the group's user members
 *  (app members never appear here — use `listMembers`). Keyset on the
 *  label, a different cursor shape from `listMembers`. */
export async function searchMembers(
  groupNanoid: string,
  q: string,
  options: SearchMembersOptions = {},
): Promise<{ members: Member[]; next_cursor: LabelCursor | null }> {
  const json = await call<{ members: Member[]; next_cursor: LabelCursor | null }>({
    service: "simple-group",
    path: `/groups/${groupNanoid}/members/search`,
    body: { q, limit: options.limit, after_label: options.after_label },
  });
  return { members: json.members, next_cursor: json.next_cursor };
}

export async function searchAllMembers(groupNanoid: string, q: string): Promise<Member[]> {
  return collectPages<Member, LabelCursor>(async (cursor) => {
    const page = await searchMembers(groupNanoid, q, { limit: 100, ...(cursor ?? {}) });
    return { rows: page.members, nextCursor: page.next_cursor };
  });
}

export async function resolveMember(groupNanoid: string, subject: Subject): Promise<boolean> {
  const json = await call<{ member: boolean }>({
    service: "simple-group",
    path: `/groups/${groupNanoid}/members/resolve`,
    body: { subject_type: subject.subject_type, subject_id: subject.subject_id },
  });
  return json.member;
}

// ── Permissions ──────────────────────────────────────────────────────────

/** Grants `action` on the group to a user. An `app` subject is refused with
 *  `400 app_grant_unsupported` and stores nothing (an app grant would
 *  authorize nothing); that refusal comes before the group is looked up. */
export async function addPermission(
  groupNanoid: string,
  action: GroupAction,
  subject: Subject,
): Promise<void> {
  assertGroupAction(action);
  await call<{ ok: true }>({
    service: "simple-group",
    path: `/groups/${groupNanoid}/members/${action}/permission/add`,
    body: { subject_type: subject.subject_type, subject_id: subject.subject_id },
  });
}

export async function removePermission(
  groupNanoid: string,
  action: GroupAction,
  subject: Subject,
): Promise<void> {
  assertGroupAction(action);
  await call<{ ok: true }>({
    service: "simple-group",
    path: `/groups/${groupNanoid}/members/${action}/permission/remove`,
    body: { subject_type: subject.subject_type, subject_id: subject.subject_id },
  });
}

/** The only listing on this service with a top-level `action` echo —
 *  preserved as-is rather than dropped as redundant, matching the
 *  server's own shape. The paged primitive; use `listAllPermissions` to
 *  walk to the end. */
export async function listPermissions(
  groupNanoid: string,
  action: GroupAction,
  options: ListMembersOptions = {},
): Promise<{ action: GroupAction; permissions: Permission[]; next_cursor: SubjectCursor | null }> {
  assertGroupAction(action);
  const json = await call<{
    action: GroupAction;
    permissions: Permission[];
    next_cursor: SubjectCursor | null;
  }>({
    service: "simple-group",
    path: `/groups/${groupNanoid}/members/${action}/permission/list`,
    body: {
      limit: options.limit,
      after_created_time_stamp: options.after_created_time_stamp,
      after_subject_type: options.after_subject_type,
      after_subject_id: options.after_subject_id,
    },
  });
  return { action: json.action, permissions: json.permissions, next_cursor: json.next_cursor };
}

export async function listAllPermissions(
  groupNanoid: string,
  action: GroupAction,
): Promise<Permission[]> {
  return collectPages<Permission, SubjectCursor>(async (cursor) => {
    const page = await listPermissions(groupNanoid, action, { limit: 100, ...(cursor ?? {}) });
    return { rows: page.permissions, nextCursor: page.next_cursor };
  });
}

// ── Accounts ─────────────────────────────────────────────────────────────

/** Turns an exact handle into the user id of the account that holds it.
 *  The server trims it, strips one leading `@` and lower-cases it; there is
 *  no prefix match. A handle no account holds throws `PilelyError` with
 *  code `not_found` (404). */
export async function lookupHandle(handle: string): Promise<HandleLookup> {
  const json = await call<HandleLookup>({
    service: "simple-group",
    path: "/users/lookup",
    body: { handle },
  });
  return { user_id: json.user_id, handle: json.handle };
}
