// @vitest-environment jsdom
import { PilelyProvider } from "@pilely/core";
import type { PilelyClient } from "@pilely/core";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BLOB_URL_GC_MS,
  BLOB_URL_STALE_MS,
  useBlobSearch,
  useBlobUrl,
  useBlobs,
  useDeleteBlob,
  useSetBlobAccess,
  useUpload,
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

const blob = (id: string) => ({
  blob_nanoid: id,
  display_name: null,
  extension: "png",
  content_type: "image/png",
  size_bytes: 1,
  app_id: "app-1",
  read_group: null,
  anon_read: false,
  created_time_stamp: 1,
});

let requests: string[];
let held: { path: string; release(): void }[];
let hold: (path: string) => boolean;
let queryClient: QueryClient;
let globalFetchSpy: ReturnType<typeof vi.fn>;

function handle(path: string): Reply {
  if (path === "/list" || path === "/search") return { status: 200, body: { ok: true, blobs: [blob("b1")], next_cursor: null } };
  if (path === "/upload") return { status: 200, body: { ok: true, blob: blob("b2") } };
  if (/\/download$/.test(path)) return { status: 200, body: { ok: true, url: `https://r2/${requests.length}`, content_type: "image/png", size_bytes: 1 } };
  if (/\/delete$/.test(path)) return { status: 200, body: { ok: true } };
  if (/\/access\/set$/.test(path)) return { status: 200, body: { ok: true, blob: blob("b1") } };
  throw new Error(`no route ${path}`);
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

const count = (path: string): number => requests.filter((r) => r === path).length;

function useScreen() {
  return {
    list: useBlobs(),
    search: useBlobSearch("cat"),
    url1: useBlobUrl("b1"),
    url2: useBlobUrl("b9"),
    upload: useUpload(),
    remove: useDeleteBlob(),
    access: useSetBlobAccess(),
  };
}

async function screen() {
  const hook = renderHook(() => useScreen(), { wrapper });
  await waitFor(() => {
    const c = hook.result.current;
    expect(c.list.isSuccess && c.search.isSuccess && c.url1.isSuccess && c.url2.isSuccess).toBe(true);
  });
  requests = [];
  return hook;
}

describe("writes refresh reads", () => {
  it("upload refreshes blob lists and searches, not URLs", async () => {
    const { result } = await screen();
    await act(() => result.current.upload.mutateAsync({ file: new Blob(["x"]), extension: "png", content_type: "image/png", read_group: null }));
    expect(count("/upload")).toBe(1);
    expect(count("/list")).toBe(1);
    expect(count("/search")).toBe(1);
    expect(requests.filter((r) => r.endsWith("/download"))).toHaveLength(0);
  });

  it("delete refreshes lists, searches and that blob's URL only", async () => {
    const { result } = await screen();
    await act(() => result.current.remove.mutateAsync("b1"));
    expect(count("/list")).toBe(1);
    expect(count("/search")).toBe(1);
    expect(count("/blobs/b1/download")).toBe(1);
    expect(count("/blobs/b9/download")).toBe(0);
  });

  it("set access refreshes lists, searches and that blob's URL only", async () => {
    const { result } = await screen();
    await act(() => result.current.access.mutateAsync({ blobNanoid: "b1", read_group: "g" }));
    expect(count("/list")).toBe(1);
    expect(count("/search")).toBe(1);
    expect(count("/blobs/b1/download")).toBe(1);
    expect(count("/blobs/b9/download")).toBe(0);
  });
});

describe("non-optimistic writes", () => {
  it("upload never touches the cache before its response", async () => {
    const { result } = await screen();
    hold = (path) => path === "/upload";
    const before = queryClient.getQueryCache().getAll().map((q) => [q.queryHash, q.state.dataUpdatedAt, q.state.isInvalidated]);
    act(() => {
      result.current.upload.mutate({ base64: "eA==", extension: "png", content_type: "image/png", read_group: null });
    });
    await waitFor(() => expect(held).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(queryClient.getQueryCache().getAll().map((q) => [q.queryHash, q.state.dataUpdatedAt, q.state.isInvalidated])).toEqual(before);
    held[0]?.release();
    await waitFor(() => expect(result.current.upload.isSuccess).toBe(true));
    expect(count("/list")).toBe(1);
  });
});

describe("useBlobUrl", () => {
  it("serves a cached URL for less than the 300 s a minted URL is guaranteed to live", async () => {
    expect(BLOB_URL_STALE_MS + BLOB_URL_GC_MS).toBeLessThan(300_000);
    const { result } = renderHook(() => useBlobUrl("b1"), { wrapper });
    await waitFor(() => expect(result.current.data?.url).toMatch(/^https:\/\/r2\//));
    const query = queryClient.getQueryCache().find({ queryKey: ["pilely", "simple-blob", "url", "b1"] });
    const options = query?.observers[0]?.options;
    expect(options?.staleTime).toBe(BLOB_URL_STALE_MS);
    expect(options?.gcTime).toBe(BLOB_URL_GC_MS);
    expect(options?.refetchInterval).toBe(BLOB_URL_STALE_MS);
  });

  it("an undefined id disables it", async () => {
    const { result } = renderHook(() => useBlobUrl(undefined), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.fetchStatus).toBe("idle");
    expect(requests).toHaveLength(0);
  });
});

describe("outside the provider", () => {
  it.each<[string, () => unknown]>([
    ["useBlobs", () => useBlobs()],
    ["useBlobSearch", () => useBlobSearch("q")],
    ["useBlobUrl", () => useBlobUrl("b")],
    ["useUpload", () => useUpload()],
    ["useDeleteBlob", () => useDeleteBlob()],
    ["useSetBlobAccess", () => useSetBlobAccess()],
  ])("%s throws the named error", (name, hook) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(hook)).toThrow(`${name} must be used inside <PilelyProvider>`);
    spy.mockRestore();
  });
});
