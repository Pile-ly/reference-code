// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { call } from "../call.js";
import { PilelyError } from "../error.js";
import type { PilelyClient, PilelyUser } from "../types.js";
import { PilelyProvider, SignedIn, SignedOut, usePilelyAuth } from "./provider.js";
import { serviceQueryKey, useServiceInfiniteQuery, useServiceMutation, useServiceQuery } from "./service_hooks.js";

function jsonResponse(status: number, body: unknown | null): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (body === null) throw new Error("no body");
      return body;
    },
  } as unknown as Response;
}

const ALICE: PilelyUser = { id: "u-alice", handle: "alice", app: "app-1" };

interface Stub {
  client: PilelyClient;
  fetch: ReturnType<typeof vi.fn>;
  setUser(user: PilelyUser | null): void;
}

function stubRuntime(options: { ready?: Promise<boolean>; user?: PilelyUser | null; navigates?: boolean } = {}): Stub {
  let user = options.user ?? null;
  const fetch = vi.fn().mockImplementation(async () => jsonResponse(200, { ok: true, who: user?.id ?? null }));
  const client: PilelyClient = {
    ready: options.ready ?? Promise.resolve(false),
    isAppOrigin: () => true,
    apexOrigin: () => "https://pilely.app",
    authOrigin: () => "https://auth.pilely.app",
    user: () => user,
    claims: () => null,
    token: () => null,
    fetch,
    appId: () => "app-1",
    // Mock-mode shape: signs in in place and resolves.
    signIn: vi.fn(async () => {
      user = ALICE;
    }),
    // The real runtime clears its token before navigating away.
    signOut: vi.fn(() => {
      user = null;
    }),
    takeReturnPath: () => null,
  };
  window.pilely = client;
  return {
    client,
    fetch,
    setUser: (next) => {
      user = next;
    },
  };
}

let globalFetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  globalFetchSpy = vi.fn();
  vi.stubGlobal("fetch", globalFetchSpy);
});

afterEach(() => {
  cleanup();
  expect(globalFetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  delete window.pilely;
});

function wrapper({ children }: { children: ReactNode }): ReactNode {
  return <PilelyProvider>{children}</PilelyProvider>;
}

function useWho(): ReturnType<typeof useServiceQuery<{ who: string | null }>> {
  return useServiceQuery<{ who: string | null }>("useWho", {
    queryKey: serviceQueryKey("simple-db", "who"),
    queryFn: () => call<{ who: string | null }>({ service: "simple-db", path: "/who" }),
  });
}

describe("PilelyProvider: ready", () => {
  it("makes no request before ready, then exactly one", async () => {
    let resolveReady!: (value: boolean) => void;
    const stub = stubRuntime({ ready: new Promise<boolean>((resolve) => (resolveReady = resolve)) });
    const { result } = renderHook(() => ({ who: useWho(), auth: usePilelyAuth() }), { wrapper });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.auth.ready).toBe(false);
    expect(stub.fetch).toHaveBeenCalledTimes(0);

    await act(async () => resolveReady(false));
    await waitFor(() => expect(result.current.who.isSuccess).toBe(true));
    expect(stub.fetch).toHaveBeenCalledTimes(1);
    expect(result.current.auth.ready).toBe(true);
  });

  it("reads user() once ready settled", async () => {
    stubRuntime({ user: ALICE });
    const { result } = renderHook(() => usePilelyAuth(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.user).toEqual(ALICE);
  });
});

describe("PilelyProvider: identity change", () => {
  it("sign-out clears every @pilely query and the visible one refetches signed out", async () => {
    const stub = stubRuntime({ user: ALICE });
    const queryClient = new QueryClient();
    const own = ({ children }: { children: ReactNode }) => (
      <PilelyProvider queryClient={queryClient}>{children}</PilelyProvider>
    );
    const hidden = ["pilely", "simple-db", "hidden"];
    queryClient.setQueryData(hidden, { stale: true });
    queryClient.setQueryData(["not-pilely"], { kept: true });

    const { result } = renderHook(() => ({ who: useWho(), auth: usePilelyAuth() }), { wrapper: own });
    await waitFor(() => expect(result.current.who.data?.who).toBe("u-alice"));

    act(() => result.current.auth.signOut());
    expect(result.current.auth.user).toBeNull();
    expect(queryClient.getQueryData(hidden)).toBeUndefined();
    expect(queryClient.getQueryData(["not-pilely"])).toEqual({ kept: true });
    await waitFor(() => expect(result.current.who.data?.who).toBeNull());
    expect(stub.fetch).toHaveBeenCalledTimes(2);
  });

  it("an in-place sign-in updates user and refetches under the new identity", async () => {
    const stub = stubRuntime();
    const { result } = renderHook(() => ({ who: useWho(), auth: usePilelyAuth() }), { wrapper });
    await waitFor(() => expect(result.current.who.data?.who).toBeNull());

    await act(() => result.current.auth.signIn());
    expect(stub.client.signIn).toHaveBeenCalledTimes(1);
    expect(result.current.auth.user).toEqual(ALICE);
    await waitFor(() => expect(result.current.who.data?.who).toBe("u-alice"));
    expect(stub.fetch).toHaveBeenCalledTimes(2);
  });

  it("a sign-in that does not change the identity keeps the cache", async () => {
    const stub = stubRuntime({ user: ALICE });
    const { result } = renderHook(() => ({ who: useWho(), auth: usePilelyAuth() }), { wrapper });
    await waitFor(() => expect(result.current.who.data?.who).toBe("u-alice"));
    await act(() => result.current.auth.signIn());
    expect(result.current.who.data?.who).toBe("u-alice");
    expect(stub.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("retry policy", () => {
  it("surfaces a bare 404 as PilelyError(404) after exactly one request", async () => {
    const stub = stubRuntime();
    stub.fetch.mockImplementation(async () => jsonResponse(404, null));
    const { result } = renderHook(() => useWho(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(PilelyError);
    expect(result.current.error).toMatchObject({ status: 404, code: null });
    expect(stub.fetch).toHaveBeenCalledTimes(1);
  });

  it("holds under an app-supplied QueryClient whose default retries everything", async () => {
    const stub = stubRuntime();
    stub.fetch.mockImplementation(async () =>
      jsonResponse(403, { ok: false, code: "unauthenticated", reason: "no" }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 5, retryDelay: 0 } } });
    const own = ({ children }: { children: ReactNode }) => (
      <PilelyProvider queryClient={queryClient}>{children}</PilelyProvider>
    );
    const { result } = renderHook(() => useWho(), { wrapper: own });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({ status: 403, code: "unauthenticated" });
    expect(stub.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a 5xx", async () => {
    const stub = stubRuntime();
    stub.fetch
      .mockImplementationOnce(async () => jsonResponse(503, { ok: false, code: "internal", reason: "x" }))
      .mockImplementation(async () => jsonResponse(200, { ok: true, who: null }));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
    const own = ({ children }: { children: ReactNode }) => (
      <PilelyProvider queryClient={queryClient}>{children}</PilelyProvider>
    );
    const { result } = renderHook(() => useWho(), { wrapper: own });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(stub.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("outside the provider", () => {
  const silence = (): (() => void) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    return () => spy.mockRestore();
  };

  it.each<[string, () => unknown]>([
    ["usePilelyAuth", () => usePilelyAuth()],
    ["useWho", () => useWho()],
    [
      "useList",
      () =>
        useServiceInfiniteQuery("useList", {
          queryKey: ["pilely", "simple-db", "x"],
          fetchPage: async () => ({ rows: [], nextCursor: null }),
        }),
    ],
    [
      "useWrite",
      () => useServiceMutation("useWrite", { mutationFn: async () => 1, invalidates: () => [] }),
    ],
  ])("%s throws the named error", (name, hook) => {
    const restore = silence();
    expect(() => renderHook(hook)).toThrow(`${name} must be used inside <PilelyProvider>`);
    restore();
  });

  it.each([
    ["SignedIn", SignedIn],
    ["SignedOut", SignedOut],
  ] as const)("<%s> throws the named error", (name, Component) => {
    const restore = silence();
    expect(() => render(<Component>x</Component>)).toThrow(`${name} must be used inside <PilelyProvider>`);
    restore();
  });
});

describe("SignedIn / SignedOut", () => {
  it("render nothing before ready", async () => {
    stubRuntime({ ready: new Promise<boolean>(() => undefined), user: ALICE });
    render(
      <PilelyProvider>
        <SignedIn>in</SignedIn>
        <SignedOut>out</SignedOut>
      </PilelyProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("in")).toBeNull();
    expect(screen.queryByText("out")).toBeNull();
  });

  it("render by identity once ready", async () => {
    stubRuntime({ user: ALICE });
    render(
      <PilelyProvider>
        <SignedIn>in</SignedIn>
        <SignedOut>out</SignedOut>
      </PilelyProvider>,
    );
    await screen.findByText("in");
    expect(screen.queryByText("out")).toBeNull();
  });
});

describe("client.js absent", () => {
  it("is ready and signed out; a data hook reports the not-loaded error without crashing", async () => {
    delete window.pilely;
    function Probe(): ReactNode {
      const { error } = useWho();
      return <p>{error ? `error: ${error.message}` : "loading"}</p>;
    }
    render(
      <PilelyProvider>
        <SignedIn>in</SignedIn>
        <SignedOut>out</SignedOut>
        <Probe />
      </PilelyProvider>,
    );
    await screen.findByText("out");
    expect(screen.queryByText("in")).toBeNull();
    await screen.findByText(/error: pilely client not loaded/);
  });

  it("signIn rejects with the not-loaded error and signOut is a no-op", async () => {
    delete window.pilely;
    const { result } = renderHook(() => usePilelyAuth(), { wrapper });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.user).toBeNull();
    await expect(result.current.signIn()).rejects.toThrow("pilely client not loaded");
    expect(() => result.current.signOut()).not.toThrow();
  });
});
