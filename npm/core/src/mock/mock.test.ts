import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock mode is a build-time switch read when modules load, so it is set
// before any import below is evaluated.
vi.hoisted(() => {
  vi.stubEnv("VITE_PILELY_MOCK", "1");
});

import { assertPilelyRuntime } from "../assert.js";
import { call } from "../call.js";
import { PilelyError } from "../error.js";
import { appId, ready, serviceOrigin } from "../runtime.js";
import type { PilelyClient } from "../types.js";
import { mockClient } from "./client.js";
import { resetMock, seedMock } from "./control.js";
import { isMockMode } from "./flag.js";
import { disposeMockServices, registerMockService } from "./registry.js";
import type { MockSeed } from "./registry.js";
import { forgetState, MOCK_STORAGE_KEY } from "./store.js";

function memoryStorage(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => {
      data.delete(key);
    },
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

let storage: ReturnType<typeof memoryStorage>;
let globalFetchSpy: ReturnType<typeof vi.fn>;
const location = { assign: vi.fn(), replace: vi.fn(), reload: vi.fn(), href: "http://localhost/" };

/** A page reload, as far as the mock runtime can tell: memory is dropped
 *  and the next read comes back from storage. */
function reload(): void {
  disposeMockServices();
  forgetState();
}

beforeEach(() => {
  storage = memoryStorage();
  (globalThis as { localStorage?: unknown }).localStorage = storage;
  (globalThis as { window?: unknown }).window = { location };
  (globalThis as { location?: unknown }).location = location;
  globalFetchSpy = vi.fn();
  (globalThis as { fetch?: unknown }).fetch = globalFetchSpy;
});

afterEach(() => {
  resetMock();
  expect(globalFetchSpy).not.toHaveBeenCalled();
  delete (globalThis as { localStorage?: unknown }).localStorage;
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { location?: unknown }).location;
  delete (globalThis as { fetch?: unknown }).fetch;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

function pilely(): PilelyClient {
  const client = (globalThis as { window?: { pilely?: PilelyClient } }).window?.pilely;
  if (!client) throw new Error("window.pilely is not set");
  return client;
}

describe("mock runtime contract", () => {
  it("is on with the variable set to \"1\"", () => {
    expect(isMockMode()).toBe(true);
  });

  it("stands in for client.js at the client() seam and on window.pilely", async () => {
    await ready();
    expect(appId()).toBe("mock-app");
    expect(serviceOrigin("simple-db")).toBe("https://simple-db.pilely.invalid");
    const client = pilely();
    expect(client).toBe(mockClient());
    await expect(client.ready).resolves.toBe(false);
    expect(client.isAppOrigin()).toBe(true);
    expect(client.apexOrigin()).toBe("https://pilely.invalid");
    expect(client.authOrigin()).toBe("https://auth.pilely.invalid");
    expect(client.takeReturnPath()).toBeNull();
  });

  it("ignores a client.js object already on window.pilely", () => {
    const real = { appId: () => "real-app" } as unknown as PilelyClient;
    (globalThis as { window?: unknown }).window = { location, pilely: real };
    expect(appId()).toBe("mock-app");
    expect(pilely()).not.toBe(real);
  });

  it("starts signed out and never carries a token", () => {
    const client = mockClient();
    expect(client.user()).toBeNull();
    expect(client.claims()).toBeNull();
    expect(client.token()).toBeNull();
  });

  it("signIn and signOut flip identity in place and never navigate", async () => {
    const client = mockClient();
    await client.signIn();
    expect(client.user()).toEqual({ id: "mock-user", handle: "mock_user", app: "mock-app" });
    expect(client.claims()).toEqual({ sub: "mock-user", handle: "mock_user", pile_id: "mock-app" });
    expect(client.token()).toBeNull();
    client.signOut();
    expect(client.user()).toBeNull();
    expect(location.assign).not.toHaveBeenCalled();
    expect(location.replace).not.toHaveBeenCalled();
    expect(location.reload).not.toHaveBeenCalled();
    expect(location.href).toBe("http://localhost/");
  });

  it("assertPilelyRuntime passes with no client.js tag to check", () => {
    expect(() => assertPilelyRuntime()).not.toThrow();
  });
});

describe("routing to fakes", () => {
  it("throws a named error for a service with no fake", async () => {
    await expect(call({ service: "simple-email", path: "/x" })).rejects.toThrow(
      "no mock for simple-email /x",
    );
  });

  it("throws a named error for a path the fake has no route for", async () => {
    registerMockService("simple-db", () => ({ marker: "test-fake", handle: () => null }));
    await expect(call({ service: "simple-db", path: "/nope" })).rejects.toThrow(
      "no mock for simple-db /nope",
    );
  });

  it("runs real call() parsing over the fake's answers", async () => {
    registerMockService("simple-group", (ctx) => ({
      marker: "test-fake",
      handle: (request) => {
        if (request.path === "/missing") return ctx.notFound();
        if (request.path === "/refused") return ctx.refuse(409, "group_archived", "group is archived");
        return ctx.ok({ ok: true, echo: request.body });
      },
    }));
    await expect(call({ service: "simple-group", path: "/echo", body: { a: 1 } })).resolves.toEqual({
      ok: true,
      echo: { a: 1 },
    });
    const missing = call({ service: "simple-group", path: "/missing" });
    await expect(missing).rejects.toBeInstanceOf(PilelyError);
    await expect(call({ service: "simple-group", path: "/missing" })).rejects.toMatchObject({
      status: 404,
      code: null,
    });
    await expect(call({ service: "simple-group", path: "/refused" })).rejects.toMatchObject({
      status: 409,
      code: "group_archived",
      reason: "group is archived",
    });
  });

  it("hands the multipart form to the fake untouched", async () => {
    let seen: FormData | null = null;
    registerMockService("simple-blob", (ctx) => ({
      marker: "test-fake",
      handle: (request) => {
        seen = request.form;
        return ctx.ok({ ok: true });
      },
    }));
    const form = new FormData();
    form.append("extension", "png");
    await call({ service: "simple-blob", path: "/upload", form });
    expect(seen).toBe(form);
  });
});

describe("state, seed, reset", () => {
  function registerCounter(): void {
    registerMockService("simple-db", (ctx) => {
      const state = ctx.load<{ n: number }>() ?? { n: 0 };
      return {
        marker: "test-fake",
        handle: () => {
          if (!ctx.user()) return ctx.notFound();
          state.n += 1;
          ctx.save(state);
          return ctx.ok({ ok: true, n: state.n });
        },
        seed: (seed: MockSeed) => {
          state.n = seed.tables?.counter?.length ?? 0;
          ctx.save(state);
        },
      };
    });
  }

  it("persists identity and fake state across a reload under one key", async () => {
    registerCounter();
    await mockClient().signIn();
    await call({ service: "simple-db", path: "/bump" });
    expect([...storage.data.keys()]).toEqual([MOCK_STORAGE_KEY]);
    reload();
    expect(mockClient().user()).not.toBeNull();
    await expect(call({ service: "simple-db", path: "/bump" })).resolves.toEqual({ ok: true, n: 2 });
  });

  it("refuses a signed-out write with the bare 404 and accepts it after signIn", async () => {
    registerCounter();
    await expect(call({ service: "simple-db", path: "/bump" })).rejects.toMatchObject({
      status: 404,
      code: null,
    });
    await mockClient().signIn();
    await expect(call({ service: "simple-db", path: "/bump" })).resolves.toEqual({ ok: true, n: 1 });
  });

  it("seeds once and never overwrites later changes", async () => {
    registerCounter();
    seedMock({ signedIn: true, tables: { counter: [{}, {}, {}] } });
    expect(mockClient().user()).not.toBeNull();
    await expect(call({ service: "simple-db", path: "/bump" })).resolves.toEqual({ ok: true, n: 4 });
    mockClient().signOut();
    reload();
    seedMock({ signedIn: true, tables: { counter: [{}] } });
    expect(mockClient().user()).toBeNull();
    await mockClient().signIn();
    await expect(call({ service: "simple-db", path: "/bump" })).resolves.toEqual({ ok: true, n: 5 });
  });

  it("resetMock clears identity, state and the stored key", async () => {
    registerCounter();
    seedMock({ signedIn: true, tables: { counter: [{}] } });
    resetMock();
    expect(storage.data.size).toBe(0);
    expect(mockClient().user()).toBeNull();
    await mockClient().signIn();
    await expect(call({ service: "simple-db", path: "/bump" })).resolves.toEqual({ ok: true, n: 1 });
  });

  it("degrades to memory when localStorage is blocked", async () => {
    resetMock();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError: storage is blocked");
      },
    });
    reload();
    registerCounter();
    const client = mockClient();
    expect(client.user()).toBeNull();
    await client.signIn();
    expect(client.user()).not.toBeNull();
    await expect(call({ service: "simple-db", path: "/bump" })).resolves.toEqual({ ok: true, n: 1 });
    resetMock();
    expect(client.user()).toBeNull();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      writable: true,
      value: storage,
    });
  });

  it("degrades to memory when every storage call throws", async () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    (globalThis as { localStorage?: unknown }).localStorage = throwing;
    reload();
    await mockClient().signIn();
    expect(mockClient().user()).not.toBeNull();
  });
});
