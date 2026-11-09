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
  useSendTemplate,
  useSetEmailReplyTo,
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
let bodies: Record<string, unknown>[];
let held: { path: string; release(): void }[];
let hold: (path: string) => boolean;
let queryClient: QueryClient;
let globalFetchSpy: ReturnType<typeof vi.fn>;

const account = {
  app_id: "app-1",
  address: null,
  display_name: null,
  reply_to: null,
  created_time_stamp: 1,
};
const template = {
  template_id: "t1",
  name: null,
  subject: "s",
  recipient: "me@x.test",
  send_group: "g1",
  deny_group: null,
  created_time_stamp: 1,
  updated_time_stamp: 1,
};
const newTemplate = { name: null, subject: "s", html: "h", recipient: "me@x.test" };
const SEND_PATH = "/accounts/app-1/templates/t1/send";

function handle(path: string): Reply {
  if (path.endsWith("/templates/t1/send")) return { status: 200, body: { ok: true, send_id: "s1" } };
  if (path === "/accounts/list") return { status: 200, body: { ok: true, accounts: [account], next_cursor: null } };
  if (path.endsWith("/info") && !path.includes("/templates/")) {
    return { status: 200, body: { ok: true, account, daily_cap: 1, sent_today: 0, credit_blocked: false } };
  }
  if (path.endsWith("/templates/list")) return { status: 200, body: { ok: true, templates: [template], next_cursor: null } };
  if (path.includes("/templates/") && path.endsWith("/info")) return { status: 200, body: { ok: true, template: { ...template, html: "<p/>" } } };
  if (/\/templates\/(create|[^/]+\/update)$/.test(path)) return { status: 200, body: { ok: true, template } };
  if (path === "/accounts/create" || path.endsWith("/set_reply_to")) return { status: 200, body: { ok: true, account } };
  return { status: 200, body: { ok: true } };
}

beforeEach(() => {
  requests = [];
  bodies = [];
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
    fetch: vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      requests.push(path);
      bodies.push(init?.body ? JSON.parse(String(init.body)) : {});
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
    accounts: useEmailAccounts(),
    account: useEmailAccount(),
    templates: useTemplates(),
    t1: useTemplate("t1"),
    t2: useTemplate("t2"),
    sendTemplate: useSendTemplate(),
    createAccount: useCreateEmailAccount(),
    deleteAccount: useDeleteEmailAccount(),
    setReplyTo: useSetEmailReplyTo(),
    createTemplate: useCreateTemplate(),
    updateTemplate: useUpdateTemplate(),
    deleteTemplate: useDeleteTemplate(),
  };
}

async function screen() {
  const hook = renderHook(() => useScreen(), { wrapper });
  await waitFor(() => {
    const c = hook.result.current;
    expect(c.accounts.isSuccess && c.account.isSuccess && c.templates.isSuccess && c.t1.isSuccess && c.t2.isSuccess).toBe(true);
  });
  requests = [];
  bodies = [];
  return hook;
}

describe("writes refresh reads", () => {
  it("a template send refreshes useEmailAccount only (it counts toward the daily cap)", async () => {
    const { result } = await screen();
    await act(() => result.current.sendTemplate.mutateAsync({ templateId: "t1", variables: { name: "Ada" } }));
    expect(requests).toEqual([SEND_PATH, "/accounts/app-1/info"]);
  });

  it.each<[string, (s: ReturnType<typeof useScreen>) => Promise<unknown>]>([
    ["create", (s) => s.createAccount.mutateAsync()],
    ["set reply-to", (s) => s.setReplyTo.mutateAsync("support@shop.example")],
  ])("account %s refreshes the account queries only", async (_name, write) => {
    const { result } = await screen();
    await act(() => write(result.current));
    expect(count("/accounts/list")).toBe(1);
    expect(count("/accounts/app-1/info")).toBe(1);
    expect(count("/templates/")).toBe(0);
  });

  it("account delete refreshes the account queries and the templates under it", async () => {
    const { result } = await screen();
    await act(() => result.current.deleteAccount.mutateAsync());
    expect(count("/accounts/list")).toBe(1);
    expect(count("/accounts/app-1/info")).toBe(1);
    expect(count("/templates/list")).toBe(1);
    expect(count("/templates/t1/info")).toBe(1);
  });

  it("template create refreshes the template list only", async () => {
    const { result } = await screen();
    await act(() => result.current.createTemplate.mutateAsync(newTemplate));
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
    expect(count("/accounts/list")).toBe(0);
  });
});

describe("template send, template and account inputs", () => {
  it("useSendTemplate posts the variables to the template send path with the page's app id", async () => {
    const { result } = await screen();
    const answer = await act(() =>
      result.current.sendTemplate.mutateAsync({ templateId: "t1", variables: { name: "Ada", message: "Hi" } }),
    );
    expect(answer).toEqual({ send_id: "s1" });
    expect(requests[0]).toBe(SEND_PATH);
    expect(bodies[0]).toEqual({ name: "Ada", message: "Hi" });

    requests = [];
    bodies = [];
    await act(() => result.current.sendTemplate.mutateAsync({ templateId: "t1" }));
    expect(bodies[0]).toEqual({});
  });

  it("template create and update carry recipient, send_group and deny_group", async () => {
    const { result } = await screen();
    await act(() => result.current.createTemplate.mutateAsync({ ...newTemplate, send_group: "g1", deny_group: null }));
    expect(bodies[requests.indexOf("/accounts/app-1/templates/create")]).toEqual({
      name: null,
      subject: "s",
      html: "h",
      recipient: "me@x.test",
      send_group: "g1",
      deny_group: null,
    });

    requests = [];
    bodies = [];
    await act(() => result.current.updateTemplate.mutateAsync({ templateId: "t1", subject: "s", html: "h", send_group: null }));
    expect(bodies[requests.indexOf("/accounts/app-1/templates/t1/update")]).toEqual({ subject: "s", html: "h", send_group: null });
  });

  it("create takes reply_to in its object form, and set reply-to sends an address or null", async () => {
    const { result } = await screen();
    await act(() => result.current.createAccount.mutateAsync({ reply_to: "support@shop.example" }));
    expect(bodies[requests.indexOf("/accounts/create")]).toEqual({ app_id: "app-1", reply_to: "support@shop.example" });

    requests = [];
    bodies = [];
    await act(() => result.current.createAccount.mutateAsync());
    expect(bodies[requests.indexOf("/accounts/create")]).toEqual({ app_id: "app-1" });

    requests = [];
    bodies = [];
    await act(() => result.current.setReplyTo.mutateAsync("support@shop.example"));
    expect(bodies[requests.indexOf("/accounts/app-1/set_reply_to")]).toEqual({ reply_to: "support@shop.example" });

    requests = [];
    bodies = [];
    await act(() => result.current.setReplyTo.mutateAsync(null));
    expect(bodies[requests.indexOf("/accounts/app-1/set_reply_to")]).toEqual({ reply_to: null });
  });
});

describe("non-optimistic writes", () => {
  it("a template send never touches the cache before its response", async () => {
    const { result } = await screen();
    hold = (path) => path === SEND_PATH;
    const before = queryClient.getQueryCache().getAll().map((q) => [q.queryHash, q.state.dataUpdatedAt, q.state.isInvalidated]);
    act(() => {
      result.current.sendTemplate.mutate({ templateId: "t1" });
    });
    await waitFor(() => expect(held).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queryClient.getQueryCache().getAll().map((q) => [q.queryHash, q.state.dataUpdatedAt, q.state.isInvalidated])).toEqual(before);
    held[0]?.release();
    await waitFor(() => expect(result.current.sendTemplate.isSuccess).toBe(true));
  });
});

describe("outside the provider", () => {
  it.each<[string, () => unknown]>([
    ["useSendTemplate", () => useSendTemplate()],
    ["useEmailAccounts", () => useEmailAccounts()],
    ["useEmailAccount", () => useEmailAccount()],
    ["useCreateEmailAccount", () => useCreateEmailAccount()],
    ["useDeleteEmailAccount", () => useDeleteEmailAccount()],
    ["useSetEmailReplyTo", () => useSetEmailReplyTo()],
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

describe("challenge option", () => {
  function sent(): { path: string; challenge: string | undefined }[] {
    const fetchImpl = window.pilely?.fetch as unknown as ReturnType<typeof vi.fn>;
    return fetchImpl.mock.calls.map(([input, init]) => ({
      path: new URL(String(input)).pathname,
      challenge: ((init as RequestInit).headers as Record<string, string>)["x-pilely-challenge"],
    }));
  }

  it("every hook sends its challenge on each request it makes, and a function is asked once per request", async () => {
    let n = 0;
    const fresh = vi.fn(async () => `send-${++n}`);
    const c = { challenge: "c" };
    const hook = renderHook(
      () => ({
        accounts: useEmailAccounts(c),
        account: useEmailAccount(c),
        templates: useTemplates(c),
        t1: useTemplate("t1", c),
        sendTemplate: useSendTemplate({ challenge: fresh }),
        createAccount: useCreateEmailAccount(c),
        deleteAccount: useDeleteEmailAccount(c),
        setReplyTo: useSetEmailReplyTo(c),
        createTemplate: useCreateTemplate(c),
        updateTemplate: useUpdateTemplate(c),
        deleteTemplate: useDeleteTemplate(c),
      }),
      { wrapper },
    );
    await waitFor(() => {
      const r = hook.result.current;
      expect(r.accounts.isSuccess && r.account.isSuccess && r.templates.isSuccess && r.t1.isSuccess).toBe(true);
    });
    const r = () => hook.result.current;
    await act(async () => {
      await r().sendTemplate.mutateAsync({ templateId: "t1", variables: { name: "Ada" } });
      await r().sendTemplate.mutateAsync({ templateId: "t1", variables: { name: "Ada" } });
      await r().createAccount.mutateAsync();
      await r().setReplyTo.mutateAsync(null);
      await r().createTemplate.mutateAsync({ ...newTemplate, html: "<p/>" });
      await r().updateTemplate.mutateAsync({ templateId: "t1", subject: "s", html: "<p/>" });
      await r().deleteTemplate.mutateAsync("t1");
      await r().deleteAccount.mutateAsync();
    });
    expect(fresh).toHaveBeenCalledTimes(2);
    expect(sent().filter((s) => s.path === SEND_PATH).map((s) => s.challenge)).toEqual(["send-1", "send-2"]);
    for (const s of sent().filter((x) => x.path !== SEND_PATH)) {
      expect(s.challenge).toBe("c");
    }
  });

  it("hooks without a challenge send no x-pilely-challenge header", async () => {
    await screen();
    expect(sent().length).toBeGreaterThan(0);
    expect(sent().every((s) => s.challenge === undefined)).toBe(true);
  });
});
