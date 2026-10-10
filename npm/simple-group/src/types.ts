/** Every `code` the simple_group service can put in a `{ok:false, code, reason}`
 *  refusal. Exhaustive as of the 2026-09 review, checked against the service's
 *  `response_json.rs`.
 *
 *  `storage_exceeded` (402) and `quota_unavailable` (503) fire on `create`,
 *  `members/add` and `permission/add` — they arrived with the 2026-09-17
 *  storage wall and are the reason this union exists. `limit_reached` (409)
 *  is the 200-grants-per-action cap on `permission/add` only — there is no
 *  group or member cap. `app_grant_unsupported` (400) is `permission/add`
 *  refusing an `app` subject. */
export type SimpleGroupErrorCode =
  | "unauthenticated"
  | "bad_forwarded_identity"
  | "bad_request"
  | "not_found"
  | "group_archived"
  | "unknown_subject"
  | "limit_reached"
  | "app_grant_unsupported"
  | "storage_exceeded"
  | "quota_unavailable"
  | "out_of_traffic_credits"
  | "rate_limited"
  | "internal";

/** The closed set of subject kinds a group can hold a member for. A
 *  permission grant is `user` only: `permission/add` refuses an `app`
 *  subject with `app_grant_unsupported`. `app` grants made before that
 *  refusal still list and remove, and authorize nothing. */
export type SubjectType = "user" | "app";

/** The five delegable member actions. `"admin"` is deliberately outside
 *  this union — it is the non-delegable pseudo-action the group's own
 *  lifecycle and permission-management routes authorize with, and it can
 *  never be granted through `addPermission`. */
export type GroupAction = "add" | "remove" | "list" | "search" | "resolve";

export interface Subject {
  subject_type: SubjectType;
  subject_id: string;
}

export interface Group {
  group_nanoid: string;
  display_name: string | null;
  archived_time_stamp: number | null;
  created_time_stamp: number;
  /** While `true`, every user member may page `members/list`. Off by
   *  default; the owner sets it at create or with `set_members_can_list`. */
  members_can_list: boolean;
}

/** The shape `listGroups`/`listAllGroups` rows carry — `create`, `rename`,
 *  `archive`, `unarchive` and `set_members_can_list` answer the plain
 *  `Group` above instead. */
export interface GroupWithMemberCount extends Group {
  member_count: number;
}

/** `label` is a display-only enrichment (the subject's handle) — never an
 *  identifier, never accepted as input, and `null` when the account or app
 *  behind the subject was deleted. The row survives its subject, so never
 *  reach through this without a null check. */
export interface Member {
  subject_type: SubjectType;
  subject_id: string;
  label: string | null;
  added_by_user_id: string;
  created_time_stamp: number;
}

export interface Permission {
  subject_type: SubjectType;
  subject_id: string;
  /** `null` when the subject behind the grant was deleted — see `Member`. */
  label: string | null;
  granted_by_user_id: string;
  created_time_stamp: number;
}

/** `groups/list`'s cursor shape. */
export interface GroupCursor {
  after_created_time_stamp: number;
  after_group_nanoid: string;
}

/** `members/list` and `permission/list` share this cursor — an
 *  (created, subject) keyset triple, all three keys together or not at all. */
export interface SubjectCursor {
  after_created_time_stamp: number;
  after_subject_type: SubjectType;
  after_subject_id: string;
}

/** `members/search`'s cursor — keyset on the label alone. Do not confuse
 *  this with `SubjectCursor`: the three shapes on this service are not
 *  interchangeable. */
export interface LabelCursor {
  after_label: string;
}

/** `users/lookup`'s answer: the account holding an exact handle. `handle`
 *  is as stored, without `@`. */
export interface HandleLookup {
  user_id: string;
  handle: string;
}
