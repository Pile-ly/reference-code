// @vitest-environment jsdom
import { PilelyProvider } from "@pilely/core";
import type { PilelyClient } from "@pilely/core";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useCreateEmailAccount,
  useCreateTemplate,
  useDeleteEmailAccount,
  useDeleteTemplate,
  useEmailAccount,
  useEmailAccounts,
  useSend,
  useSends,
  useSetEmailAccountAccess,
  useTemplate,
  useTemplates,
  useUpdateTemplate,
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

let requests: string[];
let held: { path: string; release(): void }[];
let hold: (path: string) => boolean;
let queryClient: QueryClient;
let globalFetchSpy: ReturnType<typeof vi.fn>;

const account = { app_id: "app-1", address: null, display_name: null, send_group: null, created_time_stamp: 1 };
const template = { template_id: "t1", name: null, subject: "s", created_time_stamp: 1, updated_time_stamp: 1 };

function handle(path: string): Reply {
  if (path === "/send") return { status: 200, body: { ok: true, send_id: "s1", recipient_count: 1 } };
  if (path === "/sends/list") return { status: 200, body: { ok: true, sends: [], next_cursor: null } };
  if (path === "/accounts/list") return { status: 200, body: { ok: true, accounts: [account], next_cursor: null } };
  if (path.endsWith("/info") && !path.includes("/templates/")) {
    return { status: 200, body: { ok: true, account, daily_cap: 1, sent_today: 0, credit_blocked: false, phone_verified: true } };
  }
  if (path.endsWith("/templates/list")) return { status: 200, body: { ok: true, templates: [template], next_cursor: null } };
  if (path.includes("/templates/") && path.endsWith("/info")) return { status: 200, body: { ok: true, template: { ...template, html: "<p/>" } } };
  if (/\/templates\/(create|[^/]+\/update)$/.test(path)) return { status: 200, body: { ok: true, template } };
  if (path === "/accounts/create" || path.endsWith("/access/set")) return { status: 200, body: { ok: true, account } };
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

function useScreen() {
  return {
    sends: useSends(),
    accounts: useEmailAccounts(),
    account: useEmailAccount(),
    templates: useTemplates(),
    t1: useTemplate("t1"),
    t2: useTemplate("t2"),
    send: useSend(),
    createAccount: useCreateEmailAccount(),
    deleteAccount: useDeleteEmailAccount(),
    setAccess: useSetEmailAccountAccess(),
    createTemplate: useCreateTemplate(),
    updateTemplate: useUpdateTemplate(),
    deleteTemplate: useDeleteTemplate(),
  };
}

async function screen() {
  const hook = renderHook(() => useScreen(), { wrapper });
  await waitFor(() => {
    const c = hook.result.current;
    expect(c.sends.isSuccess && c.accounts.isSuccess && c.account.isSuccess && c.templates.isSuccess && c.t1.isSuccess && c.t2.isSuccess).toBe(true);
  });
  requests = [];
  return hook;
}

describe("writes refresh reads", () => {
  it("send refreshes useSends only", async () => {
    const { result } = await screen();
    await act(() => result.current.send.mutateAsync({ to: ["a@b.c"], subject: "s", html: "<p/>" }));
    expect(requests).toEqual(["/send", "/sends/list"]);
  });

  it.each<[string, (s: ReturnType<typeof useScreen>) => Promise<unknown>]>([
    ["create", (s) => s.createAccount.mutateAsync()],
    ["set access", (s) => s.setAccess.mutateAsync("g")],
  ])("account %s refreshes the account queries only", async (_name, write) => {
    const { result } = await screen();
    await act(() => write(result.current));
    expect(count("/accounts/list")).toBe(1);
    expect(count("/accounts/app-1/info")).toBe(1);
    expect(count("/sends/list")).toBe(0);
    expect(count("/templates/")).toBe(0);
  });

  it("account delete refreshes the account queries and the templates under it", async () => {
    const { result } = await screen();
    await act(() => result.current.deleteAccount.mutateAsync());
    expect(count("/accounts/list")).toBe(1);
    expect(count("/accounts/app-1/info")).toBe(1);
    expect(count("/templates/list")).toBe(1);
    expect(count("/templates/t1/info")).toBe(1);
    expect(count("/sends/list")).toBe(0);
  });

  it("template create refreshes the template list only", async () => {
    const { result } = await screen();
    await act(() => result.current.createTemplate.mutateAsync({ name: null, subject: "s", html: "h" }));
    expect(count("/templates/list")).toBe(1);
    expect(count("/templates/t1/info")).toBe(0);
    expect(count("/accounts/list")).toBe(0);
    expect(count("/accounts/app-1/info")).toBe(0);
  });

  it.each<[string, (s: ReturnType<typeof useScreen>) => Promise<unknown>]>([
    ["update", (s) => s.updateTemplate.mutateAsync({ templateId: "t1", subject: "s", html: "h" })],
    ["delete", (s) => s.deleteTemplate.mutateAsync("t1")],
  ])("template %s refreshes the template list and that template", async (_name, write) => {
    const { result } = await screen();
    await act(() => write(result.current));
    expect(count("/templates/list")).toBe(1);
    expect(count("/templates/t1/info")).toBe(1);
    expect(count("/templates/t2/info")).toBe(0);
    expect(count("/sends/list")).toBe(0);
    expect(count("/accounts/list")).toBe(0);
  });
});

describe("non-optimistic writes", () => {
  it("send never touches the cache before its response", async () => {
    const { result } = await screen();
    hold = (path) => path === "/send";
    const before = queryClient.getQueryCache().getAll().map((q) => [q.queryHash, q.state.dataUpdatedAt, q.state.isInvalidated]);
    act(() => {
      result.current.send.mutate({ to: ["a@b.c"], template_id: "t1" });
    });
    await waitFor(() => expect(held).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queryClient.getQueryCache().getAll().map((q) => [q.queryHash, q.state.dataUpdatedAt, q.state.isInvalidated])).toEqual(before);
    held[0]?.release();
    await waitFor(() => expect(result.current.send.isSuccess).toBe(true));
  });
});

describe("outside the provider", () => {
  it.each<[string, () => unknown]>([
    ["useSend", () => useSend()],
    ["useSends", () => useSends()],
    ["useEmailAccounts", () => useEmailAccounts()],
    ["useEmailAccount", () => useEmailAccount()],
    ["useCreateEmailAccount", () => useCreateEmailAccount()],
    ["useDeleteEmailAccount", () => useDeleteEmailAccount()],
    ["useSetEmailAccountAccess", () => useSetEmailAccountAccess()],
    ["useTemplates", () => useTemplates()],
    ["useTemplate", () => useTemplate("t")],
    ["useCreateTemplate", () => useCreateTemplate()],
    ["useUpdateTemplate", () => useUpdateTemplate()],
    ["useDeleteTemplate", () => useDeleteTemplate()],
  ])("%s throws the named error", (name, hook) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(hook)).toThrow(`${name} must be used inside <PilelyProvider>`);
    spy.mockRestore();
  });
});
