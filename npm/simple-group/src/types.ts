/** The closed set of subject kinds a group can hold a member or a
 *  permission grant for. */
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
}

/** The shape `listGroups`/`listAllGroups` rows carry — `create`, `rename`,
 *  `archive` and `unarchive` answer the plain `Group` above instead. */
export interface GroupWithMemberCount extends Group {
  member_count: number;
}

/** `label` is a display-only enrichment (the subject's handle) — never an
 *  identifier, never accepted as input. */
export interface Member {
  subject_type: SubjectType;
  subject_id: string;
  label: string;
  added_by_user_id: string;
  created_time_stamp: number;
}

export interface Permission {
  subject_type: SubjectType;
  subject_id: string;
  label: string;
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
