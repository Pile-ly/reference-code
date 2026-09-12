// @pilely/simple-group — a typed wrapper over the simple_group service's 13
// POST routes. See README.md for why this package types three different
// cursor shapes instead of one.

import { call, collectPages } from "@pilely/core";

import type {
  Group,
  GroupAction,
  GroupCursor,
  GroupWithMemberCount,
  LabelCursor,
  Member,
  Permission,
  Subject,
  SubjectCursor,
  SubjectType,
} from "./types.js";

export type {
  Group,
  GroupAction,
  GroupCursor,
  GroupWithMemberCount,
  LabelCursor,
  Member,
  Permission,
  Subject,
  SubjectCursor,
  SubjectType,
} from "./types.js";

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

export async function createGroup(displayName?: string): Promise<Group> {
  const json = await call<{ group: Group }>({
    service: "simple-group",
    path: "/groups/create",
    body: { display_name: displayName },
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
