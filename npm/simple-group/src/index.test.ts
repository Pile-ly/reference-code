import { afterEach, describe, expect, it, vi } from "vitest";
import type { PilelyClient } from "@pilely/core";
import {
  addMember,
  addPermission,
  archiveGroup,
  createGroup,
  listAllGroups,
  listAllMembers,
  listAllPermissions,
  listGroups,
  listMembers,
  listPermissions,
  lookupHandle,
  removeMember,
  removePermission,
  renameGroup,
  resolveMember,
  searchAllMembers,
  searchMembers,
  setMembersCanList,
  unarchiveGroup,
} from "./api.js";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function stubWindow(fetchImpl: PilelyClient["fetch"]): void {
  const client: PilelyClient = {
    ready: Promise.resolve(true),
    isAppOrigin: () => true,
    apexOrigin: () => "https://pilely.app",
    authOrigin: () => "https://auth.pilely.app",
    user: () => null,
    claims: () => null,
    token: () => null,
    fetch: fetchImpl,
    appId: () => "app-1",
    signIn: vi.fn(),
    signOut: vi.fn(),
    takeReturnPath: () => null,
  };
  (globalThis as { window?: unknown }).window = { pilely: client };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

function urlOf(fetchImpl: ReturnType<typeof vi.fn>): string {
  return String(fetchImpl.mock.calls[0]?.[0]);
}

function bodyOf(fetchImpl: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
  return JSON.parse(init.body as string);
}

const subject = { subject_type: "user" as const, subject_id: "u1" };
const base = "https://simple-group.pilely.app/groups/g1";

describe("simple-group: every route maps to the correct URL", () => {
  const cases: [string, () => Promise<unknown>, string][] = [
    ["createGroup", () => createGroup("x"), "https://simple-group.pilely.app/groups/create"],
    ["listGroups", () => listGroups(), "https://simple-group.pilely.app/groups/list"],
    ["renameGroup", () => renameGroup("g1", "x"), `${base}/rename`],
    ["archiveGroup", () => archiveGroup("g1"), `${base}/archive`],
    ["unarchiveGroup", () => unarchiveGroup("g1"), `${base}/unarchive`],
    ["setMembersCanList", () => setMembersCanList("g1", true), `${base}/set_members_can_list`],
    ["addMember", () => addMember("g1", subject), `${base}/members/add`],
    ["removeMember", () => removeMember("g1", subject), `${base}/members/remove`],
    ["listMembers", () => listMembers("g1"), `${base}/members/list`],
    ["searchMembers", () => searchMembers("g1", "q"), `${base}/members/search`],
    ["resolveMember", () => resolveMember("g1", subject), `${base}/members/resolve`],
    [
      "addPermission",
      () => addPermission("g1", "add", subject),
      `${base}/members/add/permission/add`,
    ],
    [
      "listPermissions",
      () => listPermissions("g1", "list"),
      `${base}/members/list/permission/list`,
    ],
    [
      "removePermission",
      () => removePermission("g1", "remove", subject),
      `${base}/members/remove/permission/remove`,
    ],
    ["lookupHandle", () => lookupHandle("alice"), "https://simple-group.pilely.app/users/lookup"],
  ];

  it.each(cases)("%s hits the correct path, with the /groups/{g}/ prefix intact", async (_name, run, expectedUrl) => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        group: {
          group_nanoid: "g1",
          display_name: "x",
          archived_time_stamp: null,
          created_time_stamp: 1,
          members_can_list: false,
        },
        groups: [],
        members: [],
        permissions: [],
        action: "list",
        member: true,
        next_cursor: null,
        user_id: "u1",
        handle: "alice",
      }),
    );
    stubWindow(fetchImpl);
    await run();
    expect(urlOf(fetchImpl)).toBe(expectedUrl);
  });

  it("covers all 15 registered routes", () => {
    expect(cases).toHaveLength(15);
  });
});

describe("body-building sends only named keys (deny_unknown_fields safety)", () => {
  const groupBody = {
    ok: true,
    group: { group_nanoid: "g1", display_name: null, archived_time_stamp: null, created_time_stamp: 1, members_can_list: true },
  };

  it("createGroup sends no members_can_list unless asked, and the boolean when asked", async () => {
    const plain = vi.fn().mockResolvedValue(jsonResponse(200, groupBody));
    stubWindow(plain);
    await createGroup("x");
    expect(bodyOf(plain)).toEqual({ display_name: "x" });

    const flagged = vi.fn().mockResolvedValue(jsonResponse(200, groupBody));
    stubWindow(flagged);
    const group = await createGroup(undefined, { members_can_list: true });
    expect(bodyOf(flagged)).toEqual({ members_can_list: true });
    expect(group.members_can_list).toBe(true);
  });

  it("setMembersCanList sends exactly members_can_list and returns the group", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, groupBody));
    stubWindow(fetchImpl);
    const group = await setMembersCanList("g1", false);
    expect(bodyOf(fetchImpl)).toEqual({ members_can_list: false });
    expect(group).toEqual(groupBody.group);
  });

  it("lookupHandle sends exactly handle, passed through for the server to normalize", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, user_id: "u1", handle: "alice" }));
    stubWindow(fetchImpl);
    expect(await lookupHandle(" @Alice ")).toEqual({ user_id: "u1", handle: "alice" });
    expect(bodyOf(fetchImpl)).toEqual({ handle: " @Alice " });
  });

  it("lookupHandle throws not_found on the 404", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(404, { ok: false, code: "not_found", reason: "not found" }));
    stubWindow(fetchImpl);
    await expect(lookupHandle("ali")).rejects.toMatchObject({ name: "PilelyError", status: 404, code: "not_found" });
  });

  it("addPermission surfaces app_grant_unsupported", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(400, {
        ok: false,
        code: "app_grant_unsupported",
        reason: "app permission grants authorize nothing; grant a user instead",
      }),
    );
    stubWindow(fetchImpl);
    await expect(addPermission("g1", "list", { subject_type: "app", subject_id: "a1" })).rejects.toMatchObject({
      status: 400,
      code: "app_grant_unsupported",
    });
  });

  it("addMember sends exactly subject_type and subject_id", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    stubWindow(fetchImpl);
    await addMember("g1", subject);
    expect(Object.keys(bodyOf(fetchImpl)).sort()).toEqual(["subject_id", "subject_type"]);
  });

  it("listMembers sends only the four known list keys, omitting unset ones", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, members: [], next_cursor: null }));
    stubWindow(fetchImpl);
    await listMembers("g1", { limit: 10 });
    expect(Object.keys(bodyOf(fetchImpl))).toEqual(["limit"]);
  });

  it("searchMembers sends only q, limit, after_label", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, members: [], next_cursor: null }));
    stubWindow(fetchImpl);
    await searchMembers("g1", "abc");
    expect(Object.keys(bodyOf(fetchImpl)).sort()).toEqual(["q"]);
  });
});

describe("listAll* wrappers walk their own cursor shape and send limit: 100", () => {
  it("listAllGroups", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          ok: true,
          groups: [{ group_nanoid: "g1" }],
          next_cursor: { after_created_time_stamp: 1, after_group_nanoid: "g1" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, groups: [{ group_nanoid: "g2" }], next_cursor: null }));
    stubWindow(fetchImpl);
    const rows = await listAllGroups();
    expect(rows).toHaveLength(2);
    for (const call of fetchImpl.mock.calls) {
      const init = call[1] as RequestInit;
      expect(JSON.parse(init.body as string).limit).toBe(100);
    }
  });

  it("listAllMembers walks the subject-triple cursor", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          ok: true,
          members: [{ subject_id: "u1" }],
          next_cursor: { after_created_time_stamp: 1, after_subject_type: "user", after_subject_id: "u1" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, members: [{ subject_id: "u2" }], next_cursor: null }));
    stubWindow(fetchImpl);
    const rows = await listAllMembers("g1");
    expect(rows).toHaveLength(2);
  });

  it("listAllPermissions walks the subject-triple cursor", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          ok: true,
          action: "list",
          permissions: [{ subject_id: "u1" }],
          next_cursor: { after_created_time_stamp: 1, after_subject_type: "user", after_subject_id: "u1" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { ok: true, action: "list", permissions: [{ subject_id: "u2" }], next_cursor: null }),
      );
    stubWindow(fetchImpl);
    const rows = await listAllPermissions("g1", "list");
    expect(rows).toHaveLength(2);
  });

  it("searchAllMembers walks the label cursor", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { ok: true, members: [{ subject_id: "u1" }], next_cursor: { after_label: "a" } }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, members: [{ subject_id: "u2" }], next_cursor: null }));
    stubWindow(fetchImpl);
    const rows = await searchAllMembers("g1", "q");
    expect(rows).toHaveLength(2);
  });
});

describe("group action validation", () => {
  it("rejects an invalid action before any request goes out", async () => {
    const fetchImpl = vi.fn();
    stubWindow(fetchImpl);
    // @ts-expect-error deliberately invalid at the type level too
    await expect(addPermission("g1", "admin", subject)).rejects.toThrow(/invalid group action/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("resolveMember", () => {
  it("returns the plain boolean, not a wrapped object", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, member: true }));
    stubWindow(fetchImpl);
    const result = await resolveMember("g1", subject);
    expect(result).toBe(true);
  });
});

describe("deleted subjects — the null label", () => {
  // `label` is the subject's handle, enriched at read time. When the account
  // or app behind a member was deleted the row survives its subject and the
  // service sends `label: null`. The types said `string` until the 2026-09
  // client review; these two tests are what stops that regressing.
  it("carries a null label through listMembers without throwing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        members: [
          { subject_type: "user", subject_id: "u1", label: null, added_by_user_id: "u0", created_time_stamp: 1 },
        ],
        next_cursor: null,
      }),
    );
    stubWindow(fetchImpl);
    const page = await listMembers("g1");
    expect(page.members[0]?.label).toBeNull();
    // The point of the type change: a consumer must be forced to handle this.
    expect(page.members[0]?.label ?? "(deleted)").toBe("(deleted)");
  });

  it("carries a null label through listPermissions without throwing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        permissions: [
          { subject_type: "app", subject_id: "a1", label: null, granted_by_user_id: "u0", created_time_stamp: 1 },
        ],
        next_cursor: null,
      }),
    );
    stubWindow(fetchImpl);
    const page = await listPermissions("g1", "list");
    expect(page.permissions[0]?.label).toBeNull();
  });
});
