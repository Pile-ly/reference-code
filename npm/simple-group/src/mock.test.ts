import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock mode is a build-time switch read when modules load, so it is set
// before any import below is evaluated.
vi.hoisted(() => {
  vi.stubEnv("VITE_PILELY_MOCK", "1");
});

import { appId, PilelyError, resetMock, seedMock } from "@pilely/core";
import type { MockReply, MockServiceContext, PilelyClient, PilelyUser } from "@pilely/core";
import {
  addMember,
  addPermission,
  archiveGroup,
  createGroup,
  listAllGroups,
  listAllMembers,
  listGroups,
  listPermissions,
  lookupHandle,
  removePermission,
  renameGroup,
  resolveMember,
  searchMembers,
  setMembersCanList,
  unarchiveGroup,
} from "./api.js";
import { createSimpleGroupFake } from "./mock.js";

let globalFetchSpy: ReturnType<typeof vi.fn>;

function pilely(): PilelyClient {
  const client = (globalThis as { window?: { pilely?: PilelyClient } }).window?.pilely;
  if (!client) throw new Error("window.pilely is not set");
  return client;
}

beforeEach(async () => {
  (globalThis as { window?: unknown }).window = {};
  globalFetchSpy = vi.fn();
  (globalThis as { fetch?: unknown }).fetch = globalFetchSpy;
  resetMock();
  appId();
  await pilely().signIn();
});

afterEach(() => {
  expect(globalFetchSpy).not.toHaveBeenCalled();
  resetMock();
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { fetch?: unknown }).fetch;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("simple-group fake", () => {
  it("create a group, add a member, list and resolve through the real wrapper", async () => {
    const group = await createGroup("Editors");
    expect(group).toEqual({
      group_nanoid: expect.stringMatching(/^[A-Za-z0-9]+$/),
      display_name: "Editors",
      archived_time_stamp: null,
      created_time_stamp: expect.any(Number),
      members_can_list: false,
    });

    await addMember(group.group_nanoid, { subject_type: "user", subject_id: "mock-user" });
    await addMember(group.group_nanoid, { subject_type: "user", subject_id: "u2" });
    // Idempotent, as the service is.
    await addMember(group.group_nanoid, { subject_type: "user", subject_id: "u2" });

    const members = await listAllMembers(group.group_nanoid);
    expect(members).toEqual([
      {
        subject_type: "user",
        subject_id: "mock-user",
        label: "mock_user",
        added_by_user_id: "mock-user",
        created_time_stamp: expect.any(Number),
      },
      {
        subject_type: "user",
        subject_id: "u2",
        label: "u2",
        added_by_user_id: "mock-user",
        created_time_stamp: expect.any(Number),
      },
    ]);

    const groups = await listAllGroups();
    expect(groups).toEqual([{ ...group, member_count: 2 }]);
    expect(await resolveMember(group.group_nanoid, { subject_type: "user", subject_id: "u2" })).toBe(true);
    expect(await resolveMember(group.group_nanoid, { subject_type: "app", subject_id: "u2" })).toBe(false);
    expect((await searchMembers(group.group_nanoid, "MOCK")).members.map((m) => m.subject_id)).toEqual([
      "mock-user",
    ]);
  });

  it("answers a full page with a cursor, then one empty page", async () => {
    await createGroup("a");
    await createGroup("b");
    const first = await listGroups({ limit: 2 });
    expect(first.groups.map((g) => g.display_name)).toEqual(["b", "a"]);
    expect(first.next_cursor).not.toBeNull();
    expect(await listGroups({ limit: 2, ...first.next_cursor })).toEqual({ groups: [], next_cursor: null });
  });

  it("keeps the archived and missing-group refusals in the service's shapes", async () => {
    const group = await createGroup("x");
    await archiveGroup(group.group_nanoid);
    await expect(renameGroup(group.group_nanoid, "y")).rejects.toMatchObject({
      status: 409,
      code: "group_archived",
    });
    await expect(renameGroup("nope", "y")).rejects.toMatchObject({ status: 404, code: null });
  });

  it("echoes the action on permission/list", async () => {
    const group = await createGroup();
    await addPermission(group.group_nanoid, "add", { subject_type: "user", subject_id: "u-9" });
    const page = await listPermissions(group.group_nanoid, "add");
    expect(page.action).toBe("add");
    expect(page.permissions).toEqual([
      {
        subject_type: "user",
        subject_id: "u-9",
        label: "u-9",
        granted_by_user_id: "mock-user",
        created_time_stamp: expect.any(Number),
      },
    ]);
    expect(page.next_cursor).toBeNull();
  });

  it("refuses an app permission grant, on an unknown group too, and stores nothing", async () => {
    const group = await createGroup();
    const app = { subject_type: "app" as const, subject_id: "app-9" };
    await expect(addPermission(group.group_nanoid, "add", app)).rejects.toMatchObject({
      status: 400,
      code: "app_grant_unsupported",
      reason: "app permission grants authorize nothing; grant a user instead",
    });
    await expect(addPermission("nope", "list", app)).rejects.toMatchObject({
      status: 400,
      code: "app_grant_unsupported",
    });
    expect((await listPermissions(group.group_nanoid, "add")).permissions).toEqual([]);
    // Removing one still answers, as an existing app grant stays removable.
    await expect(removePermission(group.group_nanoid, "add", app)).resolves.toBeUndefined();
  });

  it("creates with members_can_list and lets the owner set it, refusing an archived group", async () => {
    const plain = await createGroup("plain");
    expect(plain.members_can_list).toBe(false);
    const open = await createGroup("open", { members_can_list: true });
    expect(open.members_can_list).toBe(true);

    expect(await setMembersCanList(plain.group_nanoid, true)).toEqual({ ...plain, members_can_list: true });
    // Setting the value it already has succeeds and changes nothing.
    expect(await setMembersCanList(plain.group_nanoid, true)).toEqual({ ...plain, members_can_list: true });
    const rows = await listAllGroups();
    expect(rows.map((g) => [g.display_name, g.members_can_list])).toEqual([
      ["open", true],
      ["plain", true],
    ]);

    await archiveGroup(plain.group_nanoid);
    await expect(setMembersCanList(plain.group_nanoid, false)).rejects.toMatchObject({
      status: 409,
      code: "group_archived",
    });
    expect((await unarchiveGroup(plain.group_nanoid)).members_can_list).toBe(true);
    await expect(setMembersCanList("nope", true)).rejects.toMatchObject({ status: 404, code: null });
    pilely().signOut();
    await expect(setMembersCanList(plain.group_nanoid, false)).rejects.toMatchObject({ status: 404, code: null });
  });

  it("looks up the mock user's exact handle, and answers not_found otherwise", async () => {
    expect(await lookupHandle("  @MOCK_User ")).toEqual({ user_id: "mock-user", handle: "mock_user" });
    await expect(lookupHandle("mock")).rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(lookupHandle("@@mock_user")).rejects.toMatchObject({ status: 404, code: "not_found" });
    await expect(lookupHandle(" @ ")).rejects.toMatchObject({ status: 400, code: "bad_request" });
    pilely().signOut();
    await expect(lookupHandle("mock_user")).rejects.toMatchObject({ status: 401, code: "unauthenticated" });
  });

  it("refuses a signed-out write with the bare 404, then accepts it after signIn", async () => {
    pilely().signOut();
    await expect(createGroup("x")).rejects.toBeInstanceOf(PilelyError);
    await expect(createGroup("x")).rejects.toMatchObject({ status: 404, code: null });
    await pilely().signIn();
    await expect(createGroup("x")).resolves.toMatchObject({ display_name: "x" });
  });

  it("seeds groups with members", async () => {
    resetMock();
    seedMock({ signedIn: true, groups: [{ display_name: "Team", members: [{ subject_type: "user", subject_id: "u1" }] }] });
    const [team] = await listAllGroups();
    expect(team).toMatchObject({ display_name: "Team", member_count: 1 });
  });
});

// The fake behind a hand-built context, so a second user can call: the mock
// runtime itself only ever signs in one.
describe("simple-group fake: owner, members_can_list and members/list", () => {
  function harness() {
    let current: PilelyUser | null = { id: "owner", handle: "owner", app: "mock-app" };
    let slice: unknown;
    let tick = 0;
    const ctx: MockServiceContext = {
      appId: "mock-app",
      user: () => current,
      load: <T>() => slice as T | undefined,
      save: (next) => {
        slice = next;
      },
      now: () => ++tick,
      uuid: () => `uuid-${++tick}`,
      nanoid: () => `g${++tick}`,
      ok: (body, status = 200) => ({ status, body }),
      notFound: () => ({ status: 404 }),
      refuse: (status, code, reason) => ({ status, body: { ok: false, code, reason } }),
    };
    const fake = createSimpleGroupFake(ctx);
    const post = (path: string, body: unknown = {}) =>
      fake.handle({ path, body, form: null }) as MockReply;
    const as = (id: string | null) => {
      current = id === null ? null : { id, handle: id, app: "mock-app" };
    };
    return { post, as };
  }

  it("widens members/list to a user member only while the flag is on", () => {
    const { post, as } = harness();
    const created = post("/groups/create", { display_name: "club" });
    const g = (created.body as { group: { group_nanoid: string } }).group.group_nanoid;
    post(`/groups/${g}/members/add`, { subject_type: "user", subject_id: "member" });
    post(`/groups/${g}/members/add`, { subject_type: "app", subject_id: "app-1" });

    // Flag off: a member and a non-member get the uniform 404.
    as("member");
    expect(post(`/groups/${g}/members/list`)).toEqual({ status: 404 });
    as("stranger");
    expect(post(`/groups/${g}/members/list`)).toEqual({ status: 404 });
    // A non-owner cannot set the flag.
    expect(post(`/groups/${g}/set_members_can_list`, { members_can_list: true })).toEqual({ status: 404 });
    as("member");
    expect(post(`/groups/${g}/set_members_can_list`, { members_can_list: true })).toEqual({ status: 404 });

    as("owner");
    expect(post(`/groups/${g}/set_members_can_list`, { members_can_list: "yes" }).status).toBe(400);
    expect(post(`/groups/${g}/set_members_can_list`, {}).status).toBe(400);
    expect(post(`/groups/${g}/set_members_can_list`, { members_can_list: true }).status).toBe(200);

    // Flag on: the member pages every member, user and app; a non-member still 404s.
    as("member");
    const page = post(`/groups/${g}/members/list`);
    expect(page.status).toBe(200);
    expect((page.body as { members: { subject_id: string }[] }).members.map((m) => m.subject_id)).toEqual([
      "member",
      "app-1",
    ]);
    as("stranger");
    expect(post(`/groups/${g}/members/list`)).toEqual({ status: 404 });
    as(null);
    expect(post(`/groups/${g}/members/list`)).toEqual({ status: 404 });

    // Archived: the member gets 409, the owner keeps the read.
    as("owner");
    post(`/groups/${g}/archive`);
    expect(post(`/groups/${g}/members/list`).status).toBe(200);
    as("member");
    expect(post(`/groups/${g}/members/list`)).toMatchObject({ status: 409, body: { code: "group_archived" } });

    // Unarchived and flag off: 404 again.
    as("owner");
    post(`/groups/${g}/unarchive`);
    post(`/groups/${g}/set_members_can_list`, { members_can_list: false });
    as("member");
    expect(post(`/groups/${g}/members/list`)).toEqual({ status: 404 });

    // Flag on, member removed: 404 on the next request.
    as("owner");
    post(`/groups/${g}/set_members_can_list`, { members_can_list: true });
    post(`/groups/${g}/members/remove`, { subject_type: "user", subject_id: "member" });
    as("member");
    expect(post(`/groups/${g}/members/list`)).toEqual({ status: 404 });
  });

  it("keeps a list grant holder's read with the flag off", () => {
    const { post, as } = harness();
    const created = post("/groups/create", {});
    const g = (created.body as { group: { group_nanoid: string } }).group.group_nanoid;
    post(`/groups/${g}/members/list/permission/add`, { subject_type: "user", subject_id: "reader" });
    as("reader");
    expect(post(`/groups/${g}/members/list`).status).toBe(200);
  });

  it("refuses a non-boolean members_can_list at create", () => {
    const { post } = harness();
    expect(post("/groups/create", { members_can_list: 1 })).toMatchObject({
      status: 400,
      body: { code: "bad_request" },
    });
  });
});
