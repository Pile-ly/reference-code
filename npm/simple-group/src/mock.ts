// The in-browser fake of the simple_group service that `@pilely/core`'s
// mock runtime routes to in mock mode. It answers every route this
// package's wrapper calls with the JSON the real service returns. Groups,
// members and permission grants live in memory and persist through the
// core store. It models shape, not policy: any signed-in user may run every
// route on every group, and there are no caps, storage walls or quotas.
// Three rules are modelled because the contract turns on them: the group's
// creator owns it, and only the owner may `set_members_can_list`;
// `members/list` answers the owner, a `list` grant holder, and a user
// member while `members_can_list` is on (409 for a non-owner on an archived
// group); `permission/add` refuses an `app` subject with
// `app_grant_unsupported`. Writes need a signed-in user; a signed-out
// write, a missing group and an invalid action answer the uniform bare 404.
// `users/lookup` matches exactly over the mock's one account (the signed-in
// mock user) and answers a miss with the `not_found` envelope. A subject's
// label is its id (the mock user's is its handle). Reached only from the
// `isMockMode()` branch in index.ts, so a production build carries none
// of it.

import type { MockReply, MockServiceContext, MockServiceFactory, MockSeed } from "@pilely/core";

import type {
  Group,
  GroupAction,
  GroupCursor,
  GroupWithMemberCount,
  LabelCursor,
  Member,
  Permission,
  SubjectCursor,
  SubjectType,
} from "./types.js";

const MARKER = "pilely-mock-fake:simple-group";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const DISPLAY_NAME_MAX_CHARS = 120;
const ACTIONS: readonly GroupAction[] = ["add", "remove", "list", "search", "resolve"];

interface GroupState extends Group {
  /** The creator's user id; `null` (or absent, in state persisted before
   *  ownership was modelled) for a group seeded signed out, which the
   *  signed-in mock user owns. */
  owner_user_id?: string | null;
  members: Member[];
  permissions: Partial<Record<GroupAction, Permission[]>>;
}

interface State {
  groups: GroupState[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReply(value: unknown): value is MockReply {
  return isObject(value) && typeof value.status === "number";
}

function pageSize(body: Record<string, unknown>): number {
  const raw = body.limit === undefined || body.limit === null ? DEFAULT_PAGE_SIZE : Number(body.limit);
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isFinite(raw) ? Math.trunc(raw) : DEFAULT_PAGE_SIZE));
}

function compare(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** members/list and permission/list order: created ASC, subject_type ASC,
 *  subject_id ASC. */
function bySubjectKey(a: Member | Permission, b: Member | Permission): number {
  return (
    compare(a.created_time_stamp, b.created_time_stamp) ||
    compare(a.subject_type, b.subject_type) ||
    compare(a.subject_id, b.subject_id)
  );
}

function groupPayload(group: GroupState): Group {
  return {
    group_nanoid: group.group_nanoid,
    display_name: group.display_name,
    archived_time_stamp: group.archived_time_stamp,
    created_time_stamp: group.created_time_stamp,
    // Absent in state persisted before the flag existed: off, as on the
    // service for every group created before it.
    members_can_list: group.members_can_list === true,
  };
}

/** The service's handle normalization: trim, drop ONE leading `@`,
 *  lower-case. `null` when nothing is left. */
function normalizeHandle(raw: string): string | null {
  const trimmed = raw.trim();
  const bare = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return bare === "" ? null : bare.toLowerCase();
}

const NOT_FOUND_REASON = "not found";
const APP_GRANT_UNSUPPORTED_REASON = "app permission grants authorize nothing; grant a user instead";

export const createSimpleGroupFake: MockServiceFactory = (ctx: MockServiceContext) => {
  const state: State = ctx.load<State>() ?? { groups: [] };
  const save = () => ctx.save(state);

  function labelFor(subjectType: SubjectType, subjectId: string): string {
    const user = ctx.user();
    if (subjectType === "user" && user && user.id === subjectId && user.handle) return user.handle;
    return subjectId;
  }

  function subjectOf(body: Record<string, unknown>): { subject_type: SubjectType; subject_id: string } | MockReply {
    if (body.subject_type !== "user" && body.subject_type !== "app") {
      return ctx.refuse(400, "bad_request", "subject_type must be user or app");
    }
    if (typeof body.subject_id !== "string" || body.subject_id === "") {
      return ctx.refuse(400, "bad_request", "subject_id is required");
    }
    return { subject_type: body.subject_type, subject_id: body.subject_id };
  }

  function displayNameOf(body: Record<string, unknown>): string | null | MockReply {
    if (body.display_name === undefined || body.display_name === null) return null;
    const length = typeof body.display_name === "string" ? [...body.display_name].length : 0;
    if (length < 1 || length > DISPLAY_NAME_MAX_CHARS) {
      return ctx.refuse(400, "bad_request", "display_name must be 1..=120 characters");
    }
    return body.display_name as string;
  }

  /** The group's owner is the signed-in caller (see `owner_user_id`). */
  function isOwner(group: GroupState): boolean {
    const user = ctx.user();
    if (!user) return false;
    return group.owner_user_id === undefined || group.owner_user_id === null || group.owner_user_id === user.id;
  }

  /** The caller as a `user` subject holds a row in `rows`. */
  function callerIn(rows: readonly (Member | Permission)[]): boolean {
    const id = ctx.user()?.id;
    return id !== undefined && id !== null && rows.some((r) => r.subject_type === "user" && r.subject_id === id);
  }

  function membersCanListOf(body: Record<string, unknown>): boolean | MockReply {
    if (body.members_can_list === undefined || body.members_can_list === null) return false;
    if (typeof body.members_can_list !== "boolean") {
      return ctx.refuse(400, "bad_request", "members_can_list must be true or false");
    }
    return body.members_can_list;
  }

  function createGroup(displayName: string | null, membersCanList = false): GroupState {
    const group: GroupState = {
      group_nanoid: ctx.nanoid(),
      display_name: displayName,
      archived_time_stamp: null,
      created_time_stamp: ctx.now(),
      members_can_list: membersCanList,
      owner_user_id: ctx.user()?.id ?? null,
      members: [],
      permissions: {},
    };
    state.groups.push(group);
    return group;
  }

  function addMember(group: GroupState, subjectType: SubjectType, subjectId: string): void {
    const exists = group.members.some((m) => m.subject_type === subjectType && m.subject_id === subjectId);
    if (!exists) {
      group.members.push({
        subject_type: subjectType,
        subject_id: subjectId,
        label: labelFor(subjectType, subjectId),
        added_by_user_id: ctx.user()?.id ?? "mock-user",
        created_time_stamp: ctx.now(),
      });
    }
  }

  function subjectPage<T extends Member | Permission>(rows: T[], body: Record<string, unknown>) {
    const limit = pageSize(body);
    const keys = [body.after_created_time_stamp, body.after_subject_type, body.after_subject_id].filter(
      (k) => k !== undefined && k !== null,
    ).length;
    if (keys !== 0 && keys !== 3) return null;
    let sorted = [...rows].sort(bySubjectKey);
    if (keys === 3) {
      const after = {
        created_time_stamp: Number(body.after_created_time_stamp),
        subject_type: String(body.after_subject_type) as SubjectType,
        subject_id: String(body.after_subject_id),
      } as T;
      sorted = sorted.filter((row) => bySubjectKey(row, after) > 0);
    }
    const page = sorted.slice(0, limit);
    const last = page[page.length - 1];
    // A cursor whenever the page is full, as the service does.
    const nextCursor: SubjectCursor | null =
      page.length === limit && last
        ? {
            after_created_time_stamp: last.created_time_stamp,
            after_subject_type: last.subject_type,
            after_subject_id: last.subject_id,
          }
        : null;
    return { page: page.map((row) => ({ ...row })), nextCursor };
  }

  function handle(path: string, rawBody: unknown): MockReply | null {
    const body = isObject(rawBody) ? rawBody : {};
    const signedIn = ctx.user() !== null;

    if (path === "/groups/create") {
      if (!signedIn) return ctx.notFound();
      const displayName = displayNameOf(body);
      if (isReply(displayName)) return displayName;
      const membersCanList = membersCanListOf(body);
      if (isReply(membersCanList)) return membersCanList;
      const group = createGroup(displayName, membersCanList);
      save();
      return ctx.ok({ ok: true, group: groupPayload(group) });
    }

    if (path === "/groups/list") {
      const limit = pageSize(body);
      const hasMs = body.after_created_time_stamp !== undefined && body.after_created_time_stamp !== null;
      const hasId = body.after_group_nanoid !== undefined && body.after_group_nanoid !== null;
      if (hasMs !== hasId) return ctx.refuse(400, "bad_request", "cursor needs both keys or neither");
      let sorted = [...state.groups].sort(
        (a, b) => compare(b.created_time_stamp, a.created_time_stamp) || compare(b.group_nanoid, a.group_nanoid),
      );
      if (hasMs) {
        const afterMs = Number(body.after_created_time_stamp);
        const afterId = String(body.after_group_nanoid);
        sorted = sorted.filter(
          (g) => g.created_time_stamp < afterMs || (g.created_time_stamp === afterMs && g.group_nanoid < afterId),
        );
      }
      const page = sorted.slice(0, limit);
      const last = page[page.length - 1];
      const nextCursor: GroupCursor | null =
        page.length === limit && last
          ? { after_created_time_stamp: last.created_time_stamp, after_group_nanoid: last.group_nanoid }
          : null;
      const groups: GroupWithMemberCount[] = page.map((g) => ({ ...groupPayload(g), member_count: g.members.length }));
      return ctx.ok({ ok: true, groups, next_cursor: nextCursor });
    }

    if (path === "/users/lookup") {
      const user = ctx.user();
      if (!user) return ctx.refuse(401, "unauthenticated", "authentication required");
      const unknown = Object.keys(body).filter((k) => k !== "handle");
      if (!isObject(rawBody) || unknown.length > 0 || typeof body.handle !== "string") {
        return ctx.refuse(400, "bad_request", "handle (a non-blank string) is required");
      }
      const handle = normalizeHandle(body.handle);
      if (handle === null) return ctx.refuse(400, "bad_request", "handle (a non-blank string) is required");
      // The mock's one account is the mock user; the match is exact.
      if (user.id === null || user.handle === null || user.handle.toLowerCase() !== handle) {
        return ctx.refuse(404, "not_found", NOT_FOUND_REASON);
      }
      return ctx.ok({ ok: true, user_id: user.id, handle: user.handle });
    }

    const parts = path.split("/").filter((p) => p !== "").map(decodeURIComponent);
    if (parts[0] !== "groups" || parts[1] === undefined) return null;
    const group = state.groups.find((g) => g.group_nanoid === parts[1]);
    const rest = parts.slice(2).join("/");
    const archived = group?.archived_time_stamp !== null && group?.archived_time_stamp !== undefined;
    const archivedReply = () => ctx.refuse(409, "group_archived", "group is archived");

    switch (rest) {
      case "rename": {
        if (!signedIn || !group) return ctx.notFound();
        if (archived) return archivedReply();
        const displayName = displayNameOf(body);
        if (isReply(displayName)) return displayName;
        group.display_name = displayName;
        save();
        return ctx.ok({ ok: true, group: groupPayload(group) });
      }
      case "set_members_can_list": {
        if (!signedIn || !group || !isOwner(group)) return ctx.notFound();
        if (archived) return archivedReply();
        if (typeof body.members_can_list !== "boolean" || Object.keys(body).some((k) => k !== "members_can_list")) {
          return ctx.refuse(400, "bad_request", "members_can_list (true or false) is required");
        }
        group.members_can_list = body.members_can_list;
        save();
        return ctx.ok({ ok: true, group: groupPayload(group) });
      }
      case "archive": {
        if (!signedIn || !group) return ctx.notFound();
        if (archived) return archivedReply();
        group.archived_time_stamp = ctx.now();
        save();
        return ctx.ok({ ok: true, group: groupPayload(group) });
      }
      case "unarchive": {
        if (!signedIn || !group) return ctx.notFound();
        group.archived_time_stamp = null;
        save();
        return ctx.ok({ ok: true, group: groupPayload(group) });
      }
      case "members/add": {
        if (!signedIn || !group) return ctx.notFound();
        if (archived) return archivedReply();
        const subject = subjectOf(body);
        if (isReply(subject)) return subject;
        addMember(group, subject.subject_type, subject.subject_id);
        save();
        return ctx.ok({ ok: true });
      }
      case "members/remove": {
        if (!signedIn) return ctx.notFound();
        const subject = subjectOf(body);
        if (isReply(subject)) return subject;
        const self = subject.subject_type === "user" && subject.subject_id === ctx.user()?.id;
        if (!group) return self ? ctx.ok({ ok: true }) : ctx.notFound();
        group.members = group.members.filter(
          (m) => !(m.subject_type === subject.subject_type && m.subject_id === subject.subject_id),
        );
        save();
        return ctx.ok({ ok: true });
      }
      case "members/list": {
        if (!group) return ctx.notFound();
        if (!isOwner(group)) {
          const allowed =
            callerIn(group.permissions.list ?? []) || (group.members_can_list === true && callerIn(group.members));
          if (!allowed) return ctx.notFound();
          if (archived) return archivedReply();
        }
        const result = subjectPage(group.members, body);
        if (!result) return ctx.refuse(400, "bad_request", "cursor needs all three keys or none");
        return ctx.ok({ ok: true, members: result.page, next_cursor: result.nextCursor });
      }
      case "members/search": {
        if (!group) return ctx.notFound();
        const q = typeof body.q === "string" ? body.q.trim().toLowerCase() : "";
        if (q === "") return ctx.refuse(400, "bad_request", "q is required");
        const limit = pageSize(body);
        const afterLabel = typeof body.after_label === "string" ? body.after_label : null;
        const rows = group.members
          .filter((m) => m.subject_type === "user" && (m.label ?? "").toLowerCase().startsWith(q))
          .filter((m) => afterLabel === null || (m.label ?? "") > afterLabel)
          .sort((a, b) => compare(a.label ?? "", b.label ?? ""));
        const page = rows.slice(0, limit);
        const last = page[page.length - 1];
        const nextCursor: LabelCursor | null =
          page.length === limit && last ? { after_label: last.label ?? "" } : null;
        return ctx.ok({ ok: true, members: page.map((m) => ({ ...m })), next_cursor: nextCursor });
      }
      case "members/resolve": {
        if (!group) return ctx.notFound();
        const subject = subjectOf(body);
        if (isReply(subject)) return subject;
        const member = group.members.some(
          (m) => m.subject_type === subject.subject_type && m.subject_id === subject.subject_id,
        );
        return ctx.ok({ ok: true, member });
      }
      default:
        break;
    }

    const permission = /^members\/([^/]+)\/permission\/(add|remove|list)$/.exec(rest);
    if (!permission) return null;
    const action = permission[1] as GroupAction;
    const verb = permission[2];
    if (!ACTIONS.includes(action)) return ctx.notFound();
    // Refused before the group is looked up, so an unknown group answers it too.
    if (verb === "add" && signedIn && isObject(rawBody) && rawBody.subject_type === "app") {
      return ctx.refuse(400, "app_grant_unsupported", APP_GRANT_UNSUPPORTED_REASON);
    }
    if (!group) return ctx.notFound();
    const grants = group.permissions[action] ?? [];

    if (verb === "list") {
      const result = subjectPage(grants, body);
      if (!result) return ctx.refuse(400, "bad_request", "cursor needs all three keys or none");
      return ctx.ok({ ok: true, action, permissions: result.page, next_cursor: result.nextCursor });
    }
    if (!signedIn) return ctx.notFound();
    const subject = subjectOf(body);
    if (isReply(subject)) return subject;
    if (verb === "add") {
      if (archived) return archivedReply();
      if (!grants.some((p) => p.subject_type === subject.subject_type && p.subject_id === subject.subject_id)) {
        grants.push({
          subject_type: subject.subject_type,
          subject_id: subject.subject_id,
          label: labelFor(subject.subject_type, subject.subject_id),
          granted_by_user_id: ctx.user()?.id ?? "mock-user",
          created_time_stamp: ctx.now(),
        });
      }
      group.permissions[action] = grants;
    } else {
      group.permissions[action] = grants.filter(
        (p) => !(p.subject_type === subject.subject_type && p.subject_id === subject.subject_id),
      );
    }
    save();
    return ctx.ok({ ok: true });
  }

  function seed(input: MockSeed): void {
    if (!input.groups) return;
    for (const spec of input.groups) {
      const group = createGroup(spec.display_name ?? null);
      for (const member of spec.members ?? []) {
        addMember(group, member.subject_type, member.subject_id);
      }
    }
    save();
  }

  return { marker: MARKER, handle: (request) => handle(request.path, request.body), seed };
};
