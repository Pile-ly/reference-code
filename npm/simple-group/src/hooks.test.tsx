// @vitest-environment jsdom
import { PilelyProvider } from "@pilely/core";
import type { PilelyClient } from "@pilely/core";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
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
} from "./index.js";

interface Reply {
  status: number;
  body?: unknown;
}

function respond(reply: Reply): Response {
  return {
    ok: reply.status >= 200 && reply.status < 300,
    status: reply.status,
    json: async () => {
      if (reply.body === undefined) throw new Error("no body");
      return reply.body;
    },
  } as unknown as Response;
}

const group = { group_nanoid: "g1", display_name: null, archived_time_stamp: null, created_time_stamp: 1 };

let requests: string[];
let held: { path: string; release(): void }[];
let hold: (path: string) => boolean;
let queryClient: QueryClient;
let globalFetchSpy: ReturnType<typeof vi.fn>;

function handle(path: string): Reply {
  if (path === "/groups/list") return { status: 200, body: { ok: true, groups: [{ ...group, member_count: 0 }], next_cursor: null } };
  if (/\/(members|permission)\/list$/.test(path)) {
    return { status: 200, body: { ok: true, action: "add", members: [], permissions: [], next_cursor: null } };
  }
  if (/\/members\/search$/.test(path)) return { status: 200, body: { ok: true, members: [], next_cursor: null } };
  if (/\/members\/resolve$/.test(path)) return { status: 200, body: { ok: true, member: false } };
  if (/\/(create|rename|archive|unarchive)$/.test(path)) return { status: 200, body: { ok: true, group } };
  return { status: 200, body: { ok: true } };
}

beforeEach(() => {
  requests = [];
  held = [];
  hold = () => false;
  queryClient = new QueryClient();
  globalFetchSpy = vi.fn();
  vi.stubGlobal("fetch", globalFetchSpy);
  const client: PilelyClient = {
    ready: Promise.resolve(false),
    isAppOrigin: () => true,
    apexOrigin: () => "https://pilely.app",
    authOrigin: () => "https://auth.pilely.app",
    user: () => ({ id: "u", handle: "u", app: "app-1" }),
    claims: () => null,
    token: () => null,
    fetch: vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      requests.push(path);
      if (!hold(path)) return respond(handle(path));
      return new Promise<Response>((resolve) => held.push({ path, release: () => resolve(respond(handle(path))) }));
    }),
    appId: () => "app-1",
    signIn: vi.fn(),
    signOut: vi.fn(),
    takeReturnPath: () => null,
  };
  window.pilely = client;
});

afterEach(() => {
  cleanup();
  expect(globalFetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  delete window.pilely;
});

function wrapper({ children }: { children: ReactNode }): ReactNode {
  return <PilelyProvider queryClient={queryClient}>{children}</PilelyProvider>;
}

const count = (fragment: string): number => requests.filter((r) => r.includes(fragment)).length;
const subject = { subject_type: "user" as const, subject_id: "u2" };

function useScreen() {
  return {
    groups: useGroups(),
    members1: useMembers("g1"),
    search1: useMemberSearch("g1", "a"),
    resolve1: useMembership("g1", subject),
    perms1: usePermissions("g1", "add"),
    members2: useMembers("g2"),
    create: useCreateGroup(),
    rename: useRenameGroup(),
    archive: useArchiveGroup(),
    unarchive: useUnarchiveGroup(),
    addMember: useAddMember(),
    removeMember: useRemoveMember(),
    addPermission: useAddPermission(),
    removePermission: useRemovePermission(),
  };
}

async function screen() {
  const hook = renderHook(() => useScreen(), { wrapper });
  await waitFor(() => {
    const c = hook.result.current;
    expect(
      c.groups.isSuccess && c.members1.isSuccess && c.search1.isSuccess && c.resolve1.isSuccess && c.perms1.isSuccess && c.members2.isSuccess,
    ).toBe(true);
  });
  requests = [];
  return hook;
}

describe("writes refresh reads", () => {
  it.each<[string, (s: ReturnType<typeof useScreen>) => Promise<unknown>]>([
    ["create", (s) => s.create.mutateAsync("team")],
    ["rename", (s) => s.rename.mutateAsync({ group: "g1", displayName: "x" })],
    ["archive", (s) => s.archive.mutateAsync("g1")],
    ["unarchive", (s) => s.unarchive.mutateAsync("g1")],
  ])("group %s refreshes useGroups only", async (_name, write) => {
    const { result } = await screen();
    await act(() => write(result.current));
    expect(count("/groups/list")).toBe(1);
    expect(count("/members/")).toBe(0);
  });

  it.each<[string, (s: ReturnType<typeof useScreen>) => Promise<unknown>]>([
    ["member add", (s) => s.addMember.mutateAsync({ group: "g1", subject })],
    ["member remove", (s) => s.removeMember.mutateAsync({ group: "g1", subject })],
    ["permission add", (s) => s.addPermission.mutateAsync({ group: "g1", action: "add", subject })],
    ["permission remove", (s) => s.removePermission.mutateAsync({ group: "g1", action: "add", subject })],
  ])("%s on g1 refreshes g1's members, searches, checks, permissions and useGroups", async (_name, write) => {
    const { result } = await screen();
    await act(() => write(result.current));
    expect(count("/groups/g1/members/list")).toBe(1);
    expect(count("/groups/g1/members/search")).toBe(1);
    expect(count("/groups/g1/members/resolve")).toBe(1);
    expect(count("/groups/g1/members/add/permission/list")).toBe(1);
    expect(count("/groups/list")).toBe(1);
    expect(count("/groups/g2/")).toBe(0);
  });
});

describe("non-optimistic writes", () => {
  it("a group write never touches the cache before its response", async () => {
    const { result } = await screen();
    hold = (path) => path.endsWith("/members/add");
    const before = queryClient.getQueryCache().getAll().map((q) => [q.queryHash, q.state.dataUpdatedAt, q.state.isInvalidated]);
    act(() => {
      result.current.addMember.mutate({ group: "g1", subject });
    });
    await waitFor(() => expect(held).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queryClient.getQueryCache().getAll().map((q) => [q.queryHash, q.state.dataUpdatedAt, q.state.isInvalidated])).toEqual(before);
    held[0]?.release();
    await waitFor(() => expect(result.current.addMember.isSuccess).toBe(true));
  });

  it("undefined arguments disable group-scoped reads", async () => {
    const { result } = renderHook(
      () => ({ m: useMembers(undefined), s: useMemberSearch("g1", undefined), r: useMembership("g1", undefined), p: usePermissions("g1", undefined) }),
      { wrapper },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.m.fetchStatus).toBe("idle");
    expect(requests).toHaveLength(0);
  });
});

describe("outside the provider", () => {
  it.each<[string, () => unknown]>([
    ["useGroups", () => useGroups()],
    ["useMembers", () => useMembers("g")],
    ["useMemberSearch", () => useMemberSearch("g", "q")],
    ["useMembership", () => useMembership("g", subject)],
    ["usePermissions", () => usePermissions("g", "add")],
    ["useCreateGroup", () => useCreateGroup()],
    ["useRenameGroup", () => useRenameGroup()],
    ["useArchiveGroup", () => useArchiveGroup()],
    ["useUnarchiveGroup", () => useUnarchiveGroup()],
    ["useAddMember", () => useAddMember()],
    ["useRemoveMember", () => useRemoveMember()],
    ["useAddPermission", () => useAddPermission()],
    ["useRemovePermission", () => useRemovePermission()],
  ])("%s throws the named error", (name, hook) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(hook)).toThrow(`${name} must be used inside <PilelyProvider>`);
    spy.mockRestore();
  });
});
