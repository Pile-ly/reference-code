import { serviceQueryKey, useServiceInfiniteQuery, useServiceMutation, useServiceQuery } from "@pilely/core";
import type { QueryKey, UseInfiniteQueryResult, UseMutationResult, UseQueryResult } from "@tanstack/react-query";

import {
  addMember,
  addPermission,
  archiveGroup,
  createGroup,
  listGroups,
  listMembers,
  listPermissions,
  lookupHandle,
  removeMember,
  removePermission,
  renameGroup,
  resolveMember,
  searchMembers,
  setMembersCanList,
  unarchiveGroup,
} from "./api.js";
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
} from "./types.js";

/** `["pilely", "simple-group", "groups", options]` — every `useGroups`. */
const groupsKey = (): QueryKey => serviceQueryKey("simple-group", "groups");
/** `["pilely", "simple-group", "group", groupNanoid, ...]` — every read
 *  scoped to one group: members, searches, membership checks, permissions. */
const groupKey = (groupNanoid: string | undefined): QueryKey => serviceQueryKey("simple-group", "group", groupNanoid);
/** `["pilely", "simple-group", "lookup", handle]` — every `useHandleLookup`. */
const lookupKey = (handle: string | undefined): QueryKey => serviceQueryKey("simple-group", "lookup", handle);

export interface PageOptions {
  /** Rows per page; the server defaults to 50 and caps at 100. */
  limit?: number;
}

export interface CreateGroupInput {
  displayName?: string;
  /** Let every user member page `members/list`; the server defaults it to
   *  `false`. */
  membersCanList?: boolean;
}

export interface RenameGroupInput {
  group: string;
  displayName?: string;
}

export interface SetMembersCanListInput {
  group: string;
  membersCanList: boolean;
}

export interface MemberInput {
  group: string;
  subject: Subject;
}

export interface PermissionInput {
  group: string;
  action: GroupAction;
  subject: Subject;
}

// ── Reads ────────────────────────────────────────────────────────────────

/** The caller's groups with their member counts, as an infinite query. */
export function useGroups(options: PageOptions = {}): UseInfiniteQueryResult<GroupWithMemberCount[], Error> {
  const { limit } = options;
  return useServiceInfiniteQuery<GroupWithMemberCount, GroupCursor>("useGroups", {
    queryKey: [...groupsKey(), { limit }],
    fetchPage: async (cursor) => {
      const page = await listGroups({ limit, ...(cursor ?? {}) });
      return { rows: page.groups, nextCursor: page.next_cursor };
    },
  });
}

/** One group's members, as an infinite query. An `undefined` group
 *  disables the query. */
export function useMembers(
  group: string | undefined,
  options: PageOptions = {},
): UseInfiniteQueryResult<Member[], Error> {
  const { limit } = options;
  return useServiceInfiniteQuery<Member, SubjectCursor>("useMembers", {
    queryKey: [...groupKey(group), "members", { limit }],
    fetchPage: async (cursor) => {
      const page = await listMembers(group as string, { limit, ...(cursor ?? {}) });
      return { rows: page.members, nextCursor: page.next_cursor };
    },
    enabled: group !== undefined,
  });
}

/** A case-insensitive label-prefix search among one group's user members.
 *  An `undefined` group or `q` disables the query. */
export function useMemberSearch(
  group: string | undefined,
  q: string | undefined,
  options: PageOptions = {},
): UseInfiniteQueryResult<Member[], Error> {
  const { limit } = options;
  return useServiceInfiniteQuery<Member, LabelCursor>("useMemberSearch", {
    queryKey: [...groupKey(group), "search", q, { limit }],
    fetchPage: async (cursor) => {
      const page = await searchMembers(group as string, q as string, { limit, ...(cursor ?? {}) });
      return { rows: page.members, nextCursor: page.next_cursor };
    },
    enabled: group !== undefined && q !== undefined,
  });
}

/** Whether `subject` is a member of `group`. An `undefined` argument
 *  disables the query. */
export function useMembership(
  group: string | undefined,
  subject: Subject | undefined,
): UseQueryResult<boolean, Error> {
  return useServiceQuery<boolean>("useMembership", {
    queryKey: [...groupKey(group), "resolve", subject?.subject_type, subject?.subject_id],
    queryFn: () => resolveMember(group as string, subject as Subject),
    enabled: group !== undefined && subject !== undefined,
  });
}

/** Who holds `action` on `group`, as an infinite query. An `undefined`
 *  argument disables the query. */
export function usePermissions(
  group: string | undefined,
  action: GroupAction | undefined,
  options: PageOptions = {},
): UseInfiniteQueryResult<Permission[], Error> {
  const { limit } = options;
  return useServiceInfiniteQuery<Permission, SubjectCursor>("usePermissions", {
    queryKey: [...groupKey(group), "permissions", action, { limit }],
    fetchPage: async (cursor) => {
      const page = await listPermissions(group as string, action as GroupAction, { limit, ...(cursor ?? {}) });
      return { rows: page.permissions, nextCursor: page.next_cursor };
    },
    enabled: group !== undefined && action !== undefined,
  });
}

/** The account holding an exact handle (trimmed, one leading `@` dropped,
 *  lower-cased by the server; never a prefix match). A handle no account
 *  holds is an `error` with code `not_found`. An `undefined` handle
 *  disables the query. */
export function useHandleLookup(handle: string | undefined): UseQueryResult<HandleLookup, Error> {
  return useServiceQuery<HandleLookup>("useHandleLookup", {
    queryKey: lookupKey(handle),
    queryFn: () => lookupHandle(handle as string),
    enabled: handle !== undefined,
  });
}

// ── Group writes ─────────────────────────────────────────────────────────

/** Creates a group. The variable is its optional display name, or
 *  `{ displayName?, membersCanList? }`. */
export function useCreateGroup(): UseMutationResult<Group, Error, string | CreateGroupInput | void> {
  return useServiceMutation<Group, string | CreateGroupInput | void>("useCreateGroup", {
    mutationFn: (input) =>
      typeof input === "object" && input !== null
        ? createGroup(input.displayName, { members_can_list: input.membersCanList })
        : createGroup(input ?? undefined),
    invalidates: () => [groupsKey()],
  });
}

export function useRenameGroup(): UseMutationResult<Group, Error, RenameGroupInput> {
  return useServiceMutation<Group, RenameGroupInput>("useRenameGroup", {
    mutationFn: ({ group, displayName }) => renameGroup(group, displayName),
    invalidates: () => [groupsKey()],
  });
}

/** Owner-only: turns the group's `members_can_list` on or off. */
export function useSetMembersCanList(): UseMutationResult<Group, Error, SetMembersCanListInput> {
  return useServiceMutation<Group, SetMembersCanListInput>("useSetMembersCanList", {
    mutationFn: ({ group, membersCanList }) => setMembersCanList(group, membersCanList),
    invalidates: () => [groupsKey()],
  });
}

export function useArchiveGroup(): UseMutationResult<Group, Error, string> {
  return useServiceMutation<Group, string>("useArchiveGroup", {
    mutationFn: archiveGroup,
    invalidates: () => [groupsKey()],
  });
}

export function useUnarchiveGroup(): UseMutationResult<Group, Error, string> {
  return useServiceMutation<Group, string>("useUnarchiveGroup", {
    mutationFn: unarchiveGroup,
    invalidates: () => [groupsKey()],
  });
}

// ── Member and permission writes ─────────────────────────────────────────

/** A member or permission write on group `G` refreshes `G`'s members,
 *  searches, membership checks and permissions, and `useGroups()` for its
 *  member counts. */
const memberWriteKeys = (group: string): QueryKey[] => [groupKey(group), groupsKey()];

export function useAddMember(): UseMutationResult<void, Error, MemberInput> {
  return useServiceMutation<void, MemberInput>("useAddMember", {
    mutationFn: ({ group, subject }) => addMember(group, subject),
    invalidates: (_none, { group }) => memberWriteKeys(group),
  });
}

export function useRemoveMember(): UseMutationResult<void, Error, MemberInput> {
  return useServiceMutation<void, MemberInput>("useRemoveMember", {
    mutationFn: ({ group, subject }) => removeMember(group, subject),
    invalidates: (_none, { group }) => memberWriteKeys(group),
  });
}

export function useAddPermission(): UseMutationResult<void, Error, PermissionInput> {
  return useServiceMutation<void, PermissionInput>("useAddPermission", {
    mutationFn: ({ group, action, subject }) => addPermission(group, action, subject),
    invalidates: (_none, { group }) => memberWriteKeys(group),
  });
}

export function useRemovePermission(): UseMutationResult<void, Error, PermissionInput> {
  return useServiceMutation<void, PermissionInput>("useRemovePermission", {
    mutationFn: ({ group, action, subject }) => removePermission(group, action, subject),
    invalidates: (_none, { group }) => memberWriteKeys(group),
  });
}
