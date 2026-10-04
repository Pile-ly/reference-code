import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock mode is a build-time switch read when modules load, so it is set
// before any import below is evaluated.
vi.hoisted(() => {
  vi.stubEnv("VITE_PILELY_MOCK", "1");
});

import { appId, PilelyError, resetMock, seedMock } from "@pilely/core";
import type { PilelyClient } from "@pilely/core";
import {
  addMember,
  addPermission,
  archiveGroup,
  createGroup,
  listAllGroups,
  listAllMembers,
  listGroups,
  listPermissions,
  renameGroup,
  resolveMember,
  searchMembers,
} from "./api.js";

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
    await addPermission(group.group_nanoid, "add", { subject_type: "app", subject_id: "app-9" });
    const page = await listPermissions(group.group_nanoid, "add");
    expect(page.action).toBe("add");
    expect(page.permissions).toEqual([
      {
        subject_type: "app",
        subject_id: "app-9",
        label: "app-9",
        granted_by_user_id: "mock-user",
        created_time_stamp: expect.any(Number),
      },
    ]);
    expect(page.next_cursor).toBeNull();
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
