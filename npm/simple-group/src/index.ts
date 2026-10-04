// @pilely/simple-group — React hooks over the simple_group service: a query
// hook for every read, a mutation hook for every write. Render them inside
// @pilely/core's <PilelyProvider>.

export {
  useAddMember,
  useAddPermission,
  useArchiveGroup,
  useCreateGroup,
  useGroups,
  useMemberSearch,
  useMembers,
  useMembership,
  usePermissions,
  useRemoveMember,
  useRemovePermission,
  useRenameGroup,
  useUnarchiveGroup,
} from "./hooks.js";
export type { MemberInput, PageOptions, PermissionInput, RenameGroupInput } from "./hooks.js";
export type {
  Group,
  SimpleGroupErrorCode,
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
