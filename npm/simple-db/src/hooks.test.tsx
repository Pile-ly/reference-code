// @vitest-environment jsdom
import { PilelyError, PilelyProvider, usePilelyAuth } from "@pilely/core";
import type { PilelyClient, PilelyUser } from "@pilely/core";
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TEMP_ID_PREFIX,
  useAddColumn,
  useCreateDbApp,
  useCreateRecord,
  useCreateTable,
  useDbApps,
  useDeleteDbApp,
  useDeleteRecord,
  useRecord,
  useRecords,
  useSetNewRowEmail,
  useSetTableAccess,
  useTables,
  useUpdateRecord,
} from "./index.js";
import type { DbRecord } from "./index.js";

interface Post extends DbRecord {
  title: string | null;
  topic: string | null;
}

type Row = Record<string, unknown> & { id: string };

interface Reply {
  status: number;
  body?: unknown;
}

interface Held {
  path: string;
  body: Record<string, unknown>;
  /** Runs the fake server's handler now and answers with it. */
  release(): void;
  /** Answers the uniform bare 404. */
  refuse(): void;
}

const ALICE: PilelyUser = { id: "u-alice", handle: "alice", app: "app-1" };

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

/** A small in-memory simple_db behind `window.pilely.fetch`. Requests
 *  matching `hold` wait until the test releases or refuses them. */
class FakeDb {
  tables = new Map<string, Row[]>();
  requests: { path: string; body: Record<string, unknown> }[] = [];
  held: Held[] = [];
  hold: (path: string) => boolean = () => false;
  /** When set, answers every `records/list` in place of the in-memory rows. */
  listReply: ((body: Record<string, unknown>) => Reply) | null = null;
  /** When set and it answers, its reply replaces the in-memory handler's. */
  override: ((path: string, body: Record<string, unknown>) => Reply | null) | null = null;
  private nextId = 0;
  private clock = 1_000;

  fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/apps\/app-1/, "");
    const body = (init?.body ? JSON.parse(init.body as string) : {}) as Record<string, unknown>;
    this.requests.push({ path, body });
    if (!this.hold(path)) {
      return respond(this.handle(path, body));
    }
    return new Promise<Response>((resolve) => {
      this.held.push({
        path,
        body,
        release: () => resolve(respond(this.handle(path, body))),
        refuse: () => resolve(respond({ status: 404 })),
      });
    });
  });

  seed(table: string, rows: Row[]): void {
    this.tables.set(table, rows);
  }

  count(fragment: string): number {
    return this.requests.filter((r) => r.path.includes(fragment)).length;
  }

  async waitHeld(fragment: string): Promise<Held> {
    let found: Held | undefined;
    await waitFor(() => {
      found = this.held.find((h) => h.path.includes(fragment));
      expect(found).toBeDefined();
    });
    this.held.splice(this.held.indexOf(found as Held), 1);
    return found as Held;
  }

  private rows(table: string): Row[] {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = [];
      this.tables.set(table, rows);
    }
    return rows;
  }

  private handle(path: string, body: Record<string, unknown>): Reply {
    const overridden = this.override?.(path, body);
    if (overridden) return overridden;
    if (path === "/apps/list") return { status: 200, body: { ok: true, apps: [], next_cursor: null } };
    if (path === "/create") return { status: 200, body: { ok: true, app: { app_id: "app-1" } } };
    if (path === "/delete") return { status: 200, body: { ok: true, app_id: "app-1" } };
    if (path === "/tables/list") {
      const tables = [{ name: "posts" }, { name: "comments" }];
      const start = typeof body.cursor === "string" ? Number(body.cursor.slice(1)) : 0;
      const limit = (body.limit as number | undefined) ?? 50;
      const page = tables.slice(start, start + limit);
      const more = start + limit < tables.length;
      return { status: 200, body: { ok: true, tables: page, next_cursor: more ? `c${start + limit}` : null } };
    }
    if (path === "/tables/create") return { status: 200, body: { ok: true, table: { name: "t" } } };
    let m = /^\/tables\/([^/]+)\/(columns\/add|access\/set)$/.exec(path);
    if (m) return { status: 200, body: { ok: true, table: { name: m[1] } } };
    m = /^\/tables\/([^/]+)\/notify\/set$/.exec(path);
    if (m) return { status: 200, body: { ok: true, table: m[1], new_row_email: body.new_row_email } };
    m = /^\/tables\/([^/]+)\/records\/(list|create)$/.exec(path);
    if (m) {
      const rows = this.rows(m[1] as string);
      if (m[2] === "create") {
        this.nextId += 1;
        this.clock += 1;
        const fields = body.fields as Record<string, unknown>;
        const row: Row = {
          title: null,
          topic: null,
          ...fields,
          id: `srv-${this.nextId}`,
          _created_at_ms: this.clock,
          _updated_at_ms: this.clock,
          _submitter_handle: "alice",
        };
        rows.unshift(row);
        return { status: 200, body: { ok: true, record: row } };
      }
      if (this.listReply) return this.listReply(body);
      const eq = (body.eq ?? {}) as Record<string, unknown>;
      const filtered = rows.filter((row) => Object.entries(eq).every(([k, v]) => (row[k] ?? null) === v));
      const matched = body.order === "oldest" ? filtered.slice().reverse() : filtered;
      const limit = (body.limit as number | undefined) ?? 50;
      const page = matched.slice(0, limit);
      return { status: 200, body: { ok: true, records: page, next_cursor: matched.length > limit ? "more" : null } };
    }
    m = /^\/tables\/([^/]+)\/records\/([^/]+)\/(get|update|delete)$/.exec(path);
    if (m) {
      const rows = this.rows(m[1] as string);
      const index = rows.findIndex((row) => row.id === m?.[2]);
      const row = rows[index];
      if (!row) return { status: 404 };
      if (m[3] === "get") return { status: 200, body: { ok: true, record: row } };
      if (m[3] === "delete") {
        rows.splice(index, 1);
        return { status: 200, body: { ok: true, deleted: row.id } };
      }
      const updated = { ...row, ...(body.fields as Record<string, unknown>) };
      rows[index] = updated;
      return { status: 200, body: { ok: true, record: updated } };
    }
    throw new Error(`fake simple-db has no route ${path}`);
  }
}

let db: FakeDb;
let user: PilelyUser | null;
let queryClient: QueryClient;
let resolveReady: (value: boolean) => void;
let globalFetchSpy: ReturnType<typeof vi.fn>;

function install(options: { readyNow?: boolean } = {}): void {
  const ready =
    options.readyNow === false
      ? new Promise<boolean>((resolve) => (resolveReady = resolve))
      : Promise.resolve(false);
  const client: PilelyClient = {
    ready,
    isAppOrigin: () => true,
    apexOrigin: () => "https://pilely.app",
    authOrigin: () => "https://auth.pilely.app",
    user: () => user,
    claims: () => null,
    token: () => null,
    fetch: db.fetch,
    appId: () => "app-1",
    signIn: vi.fn(async () => {
      user = ALICE;
    }),
    signOut: vi.fn(() => {
      user = null;
    }),
    takeReturnPath: () => null,
  };
  window.pilely = client;
}

beforeEach(() => {
  db = new FakeDb();
  user = ALICE;
  queryClient = new QueryClient();
  globalFetchSpy = vi.fn();
  vi.stubGlobal("fetch", globalFetchSpy);
  install();
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

function row(id: string, fields: Partial<Post> = {}, at = 100): Row {
  return {
    id,
    title: null,
    topic: null,
    ...fields,
    _created_at_ms: at,
    _updated_at_ms: at,
    _submitter_handle: "alice",
  };
}

function ids(rows: { id: string }[] | undefined): string[] {
  return (rows ?? []).map((r) => r.id);
}

describe("ready gate", () => {
  it("makes zero requests before ready, then exactly one", async () => {
    install({ readyNow: false });
    const { result } = renderHook(() => useRecords<Post>("posts"), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(db.fetch).toHaveBeenCalledTimes(0);
    await act(async () => resolveReady(false));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(db.fetch).toHaveBeenCalledTimes(1);
  });

  it("an undefined id disables useRecord", async () => {
    const { result } = renderHook(() => useRecord<Post>("posts", undefined), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.fetchStatus).toBe("idle");
    expect(db.fetch).toHaveBeenCalledTimes(0);
  });
});

describe("reads", () => {
  it("useRecords flattens pages and walks the cursor", async () => {
    db.seed("posts", [row("a", {}, 3), row("b", {}, 2), row("c", {}, 1)]);
    const { result } = renderHook(() => useRecords<Post>("posts", { limit: 2 }), { wrapper });
    await waitFor(() => expect(ids(result.current.data)).toEqual(["a", "b"]));
    expect(result.current.hasNextPage).toBe(true);
    expect(db.requests[0]?.body).toEqual({ limit: 2 });
  });

  it("useRecords sends eq on _submitter_user_id and keys the list by it", async () => {
    db.seed("posts", [
      { ...row("a", {}, 3), _submitter_user_id: "u-alice" },
      { ...row("b", {}, 2), _submitter_user_id: "u-bob" },
    ]);
    const { result } = renderHook(() => useRecords<Post>("posts", { eq: { _submitter_user_id: "u-alice" } }), {
      wrapper,
    });
    await waitFor(() => expect(ids(result.current.data)).toEqual(["a"]));
    expect(db.requests[0]?.body).toEqual({ eq: { _submitter_user_id: "u-alice" } });
    const [key] = queryClient
      .getQueryCache()
      .findAll({ queryKey: ["pilely", "simple-db", "records", "posts", "list"] })
      .map((query) => query.queryKey[5]);
    expect(key).toEqual({ eq: { _submitter_user_id: "u-alice" }, limit: undefined, order: undefined });
  });

  it("useRecords sends order and keys by it: two lists differing only in order never share a cache entry", async () => {
    db.seed("posts", [row("a", {}, 3), row("b", {}, 2), row("c", {}, 1)]);
    const { result } = renderHook(
      () => ({
        newest: useRecords<Post>("posts"),
        oldest: useRecords<Post>("posts", { order: "oldest" }),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.newest.isSuccess && result.current.oldest.isSuccess).toBe(true));
    expect(ids(result.current.newest.data)).toEqual(["a", "b", "c"]);
    expect(ids(result.current.oldest.data)).toEqual(["c", "b", "a"]);
    expect(db.requests.map((r) => r.body)).toEqual(expect.arrayContaining([{}, { order: "oldest" }]));
    expect(db.count("/records/list")).toBe(2);
    const keys = queryClient
      .getQueryCache()
      .findAll({ queryKey: ["pilely", "simple-db", "records", "posts", "list"] })
      .map((query) => query.queryKey[5]);
    expect(keys).toEqual(
      expect.arrayContaining([
        { eq: undefined, limit: undefined, order: undefined },
        { eq: undefined, limit: undefined, order: "oldest" },
      ]),
    );
    expect(keys).toHaveLength(2);
  });

  it("useRecords keeps paging through a short page and an empty page while the cursor is non-null", async () => {
    db.listReply = (body) => {
      if (body.cursor === undefined) {
        return { status: 200, body: { ok: true, records: [row("a", { topic: "news" }, 3)], next_cursor: "c1" } };
      }
      if (body.cursor === "c1") {
        return { status: 200, body: { ok: true, records: [], next_cursor: "c2" } };
      }
      return { status: 200, body: { ok: true, records: [row("b", { topic: "news" }, 1)], next_cursor: null } };
    };
    const { result } = renderHook(() => useRecords<Post>("posts", { eq: { topic: "news" }, limit: 10 }), { wrapper });
    await waitFor(() => expect(ids(result.current.data)).toEqual(["a"]));
    expect(result.current.hasNextPage).toBe(true);

    await act(() => result.current.fetchNextPage());
    await waitFor(() => expect(db.count("/records/list")).toBe(2));
    expect(ids(result.current.data)).toEqual(["a"]);
    expect(result.current.hasNextPage).toBe(true);

    await act(() => result.current.fetchNextPage());
    await waitFor(() => expect(ids(result.current.data)).toEqual(["a", "b"]));
    expect(result.current.hasNextPage).toBe(false);
    expect(db.requests.map((r) => r.body)).toEqual([
      { limit: 10, eq: { topic: "news" } },
      { limit: 10, eq: { topic: "news" }, cursor: "c1" },
      { limit: 10, eq: { topic: "news" }, cursor: "c2" },
    ]);
  });

  it("useTables returns one page and its cursor; the cursor fetches the next page", async () => {
    const first = renderHook(() => useTables({ limit: 1 }), { wrapper });
    await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
    expect(first.result.current.data).toEqual({ tables: [{ name: "posts" }], nextCursor: "c1" });
    expect(db.requests[0]?.body).toEqual({ limit: 1 });

    const cursor = first.result.current.data?.nextCursor ?? undefined;
    const second = renderHook(() => useTables({ limit: 1, cursor }), { wrapper });
    await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
    expect(second.result.current.data).toEqual({ tables: [{ name: "comments" }], nextCursor: null });
    expect(db.requests[1]?.body).toEqual({ limit: 1, cursor: "c1" });
  });

  it("useTables and useDbApps with no params send {} and return the first page", async () => {
    const { result } = renderHook(() => ({ tables: useTables(), apps: useDbApps() }), { wrapper });
    await waitFor(() => expect(result.current.tables.isSuccess && result.current.apps.isSuccess).toBe(true));
    expect(result.current.tables.data).toEqual({ tables: [{ name: "posts" }, { name: "comments" }], nextCursor: null });
    expect(result.current.apps.data).toEqual({ apps: [], nextCursor: null });
    expect(db.requests.map((r) => r.body)).toEqual([{}, {}]);
  });

  it("a bare 404 surfaces PilelyError(404) after exactly one request", async () => {
    const { result } = renderHook(() => useRecord<Post>("posts", "missing"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(PilelyError);
    expect(result.current.error).toMatchObject({ status: 404, code: null });
    expect(db.count("/records/missing/get")).toBe(1);
  });
});

describe("writes refresh reads", () => {
  function useBoard() {
    return {
      postsA: useRecords<Post>("posts"),
      postsB: useRecords<Post>("posts", { limit: 10 }),
      comments: useRecords<Post>("comments"),
      one: useRecord<Post>("posts", "p1"),
      other: useRecord<Post>("posts", "p2"),
      create: useCreateRecord<Post>("posts", { optimistic: false }),
      update: useUpdateRecord<Post>("posts", { optimistic: false }),
      remove: useDeleteRecord("posts", { optimistic: false }),
    };
  }

  async function board() {
    db.seed("posts", [row("p1", { title: "one" }), row("p2", { title: "two" })]);
    const hook = renderHook(() => useBoard(), { wrapper });
    await waitFor(() => {
      expect(hook.result.current.postsA.isSuccess).toBe(true);
      expect(hook.result.current.postsB.isSuccess).toBe(true);
      expect(hook.result.current.comments.isSuccess).toBe(true);
      expect(hook.result.current.one.isSuccess).toBe(true);
      expect(hook.result.current.other.isSuccess).toBe(true);
    });
    db.requests = [];
    return hook;
  }

  it("record create refreshes every useRecords(posts) and nothing else", async () => {
    const { result } = await board();
    await act(() => result.current.create.mutateAsync({ title: "new" }));
    expect(db.count("/tables/posts/records/list")).toBe(2);
    expect(db.count("/tables/comments/records/list")).toBe(0);
    expect(db.count("/get")).toBe(0);
    await waitFor(() => expect(result.current.postsA.data?.[0]?.title).toBe("new"));
    await waitFor(() => expect(result.current.postsB.data?.[0]?.title).toBe("new"));
  });

  it("record update refreshes the posts lists and that record's useRecord", async () => {
    const { result } = await board();
    await act(() => result.current.update.mutateAsync({ id: "p1", patch: { title: "edited" } }));
    expect(db.count("/tables/posts/records/list")).toBe(2);
    expect(db.count("/tables/comments/records/list")).toBe(0);
    expect(db.count("/records/p1/get")).toBe(1);
    expect(db.count("/records/p2/get")).toBe(0);
    await waitFor(() => expect(result.current.one.data?.title).toBe("edited"));
  });

  it("record delete refreshes the posts lists and that record's useRecord", async () => {
    const { result } = await board();
    await act(() => result.current.remove.mutateAsync("p2"));
    expect(db.count("/tables/posts/records/list")).toBe(2);
    expect(db.count("/tables/comments/records/list")).toBe(0);
    expect(db.count("/records/p2/get")).toBe(1);
    expect(db.count("/records/p1/get")).toBe(0);
    await waitFor(() => expect(ids(result.current.postsA.data)).toEqual(["p1"]));
  });

  it("table create, add column and set access refresh every useTables page; set access also that table's records", async () => {
    const { result } = renderHook(
      () => ({
        tables: useTables(),
        tablesPage2: useTables({ limit: 1, cursor: "c1" }),
        posts: useRecords<Post>("posts"),
        comments: useRecords<Post>("comments"),
        apps: useDbApps(),
        createTable: useCreateTable(),
        addColumn: useAddColumn(),
        setAccess: useSetTableAccess(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.comments.isSuccess && result.current.apps.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.tables.isSuccess && result.current.posts.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.tablesPage2.isSuccess).toBe(true));

    db.requests = [];
    await act(() =>
      result.current.createTable.mutateAsync({ table: "t", columns: [], read_group: null, write_group: null }),
    );
    expect(db.count("/tables/list")).toBe(2);
    expect(db.count("/records/list")).toBe(0);
    expect(db.count("/apps/list")).toBe(0);

    db.requests = [];
    await act(() => result.current.addColumn.mutateAsync({ table: "posts", column: { name: "x", type: "text" } }));
    expect(db.count("/tables/list")).toBe(2);
    expect(db.count("/records/list")).toBe(0);

    db.requests = [];
    await act(() =>
      result.current.setAccess.mutateAsync({ table: "posts", access: { read_group: null, write_group: null } }),
    );
    expect(db.count("/tables/list")).toBe(2);
    expect(db.count("/tables/posts/records/list")).toBe(1);
    expect(db.count("/tables/comments/records/list")).toBe(0);
  });

  it("set new-row email sends {new_row_email}, answers {table, new_row_email} and refreshes only useTables", async () => {
    const { result } = renderHook(
      () => ({
        tables: useTables(),
        tablesPage2: useTables({ limit: 1, cursor: "c1" }),
        posts: useRecords<Post>("posts"),
        apps: useDbApps(),
        setNewRowEmail: useSetNewRowEmail(),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.tables.isSuccess && result.current.posts.isSuccess).toBe(true));
    await waitFor(() => expect(result.current.tablesPage2.isSuccess && result.current.apps.isSuccess).toBe(true));

    db.requests = [];
    const answer = await act(() => result.current.setNewRowEmail.mutateAsync({ table: "posts", new_row_email: "each" }));
    expect(answer).toEqual({ table: "posts", new_row_email: "each" });
    expect(db.requests.find((r) => r.path === "/tables/posts/notify/set")?.body).toEqual({ new_row_email: "each" });
    expect(db.count("/tables/list")).toBe(2);
    expect(db.count("/records/list")).toBe(0);
    expect(db.count("/apps/list")).toBe(0);
  });

  it("useSetNewRowEmail surfaces email_not_ready as a PilelyError and refreshes nothing", async () => {
    db.override = (path) =>
      path.endsWith("/notify/set")
        ? { status: 400, body: { ok: false, code: "email_not_ready", reason: "no account" } }
        : null;
    const { result } = renderHook(() => ({ tables: useTables(), setNewRowEmail: useSetNewRowEmail() }), { wrapper });
    await waitFor(() => expect(result.current.tables.isSuccess).toBe(true));
    db.requests = [];
    await act(async () => {
      await result.current.setNewRowEmail.mutateAsync({ table: "posts", new_row_email: "daily" }).catch(() => undefined);
    });
    await waitFor(() => expect(result.current.setNewRowEmail.isError).toBe(true));
    expect(result.current.setNewRowEmail.error).toMatchObject({ status: 400, code: "email_not_ready" });
    expect(db.count("/tables/list")).toBe(0);
  });

  it("useCreateTable and useSetTableAccess send the row-level settings they are given, and only those", async () => {
    const { result } = renderHook(() => ({ createTable: useCreateTable(), setAccess: useSetTableAccess() }), {
      wrapper,
    });
    await act(() =>
      result.current.createTable.mutateAsync({
        table: "messages",
        columns: [{ name: "to_user_id", type: "text" }],
        read_group: null,
        write_group: null,
        read_scope: "own",
        audience_column: "to_user_id",
        mutate_scope: "own",
        mutate_group: "staff1",
        deny_group: "bans1",
      }),
    );
    await act(() =>
      result.current.setAccess.mutateAsync({
        table: "messages",
        access: { read_group: null, write_group: null, deny_group: null },
      }),
    );
    expect(db.requests.find((r) => r.path === "/tables/create")?.body).toEqual({
      table: "messages",
      columns: [{ name: "to_user_id", type: "text" }],
      read_group: null,
      write_group: null,
      read_scope: "own",
      audience_column: "to_user_id",
      mutate_scope: "own",
      mutate_group: "staff1",
      deny_group: "bans1",
    });
    expect(db.requests.find((r) => r.path === "/tables/messages/access/set")?.body).toEqual({
      read_group: null,
      write_group: null,
      deny_group: null,
    });
  });

  it("app create refreshes every useDbApps page; app delete refreshes everything under simple-db", async () => {
    const { result } = renderHook(
      () => ({
        apps: useDbApps(),
        appsPage2: useDbApps({ limit: 1, cursor: "1:app-0" }),
        tables: useTables(),
        posts: useRecords<Post>("posts"),
        createApp: useCreateDbApp(),
        deleteApp: useDeleteDbApp(),
      }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.apps.isSuccess && result.current.tables.isSuccess && result.current.posts.isSuccess).toBe(
        true,
      ),
    );
    await waitFor(() => expect(result.current.appsPage2.isSuccess).toBe(true));
    queryClient.setQueryData(["pilely", "simple-blob", "list", {}], { untouched: true });

    db.requests = [];
    await act(() => result.current.createApp.mutateAsync());
    expect(db.requests.map((r) => r.path)).toEqual(["/create", "/apps/list", "/apps/list"]);

    db.requests = [];
    await act(() => result.current.deleteApp.mutateAsync());
    expect(db.count("/tables/list")).toBe(1);
    expect(db.count("/records/list")).toBe(1);
    expect(db.count("/apps/list")).toBe(2);
    expect(queryClient.getQueryState(["pilely", "simple-blob", "list", {}])?.isInvalidated).toBe(false);
  });
});

describe("optimistic record writes", () => {
  function useWriter(options: { optimistic?: boolean } = {}) {
    return {
      all: useRecords<Post>("posts"),
      news: useRecords<Post>("posts", { eq: { topic: "news" } }),
      sport: useRecords<Post>("posts", { eq: { topic: "sport" } }),
      one: useRecord<Post>("posts", "p1"),
      create: useCreateRecord<Post>("posts", options),
      update: useUpdateRecord<Post>("posts", options),
      remove: useDeleteRecord("posts", options),
      auth: usePilelyAuth(),
    };
  }

  async function writer(options: { optimistic?: boolean } = {}) {
    db.seed("posts", [row("p1", { title: "one", topic: "news" }, 2), row("p2", { title: "two", topic: "sport" }, 1)]);
    const hook = renderHook(() => useWriter(options), { wrapper });
    await waitFor(() => {
      const c = hook.result.current;
      expect(c.all.isSuccess && c.news.isSuccess && c.sport.isSuccess && c.one.isSuccess).toBe(true);
    });
    db.requests = [];
    return hook;
  }

  it("create shows a temporary row at the top of matching lists before the response; the reconcile fetch replaces it", async () => {
    db.hold = (path) => path.endsWith("/records/create");
    const { result } = await writer();
    let done!: Promise<Post>;
    act(() => {
      done = result.current.create.mutateAsync({ title: "fresh", topic: "news" });
    });
    await waitFor(() => expect(result.current.all.data?.[0]?.title).toBe("fresh"));
    const temp = result.current.all.data?.[0];
    expect(temp?.id.startsWith(TEMP_ID_PREFIX)).toBe(true);
    expect(temp?._submitter_handle).toBe("alice");
    expect(temp?._submitter_user_id).toBe("u-alice");
    expect(result.current.news.data?.[0]?.id).toBe(temp?.id);
    expect(ids(result.current.sport.data)).toEqual(["p2"]);
    expect(db.count("/records/list")).toBe(0);

    (await db.waitHeld("/records/create")).release();
    await act(() => done);
    await waitFor(() => expect(result.current.all.data?.[0]?.id).toBe("srv-1"));
    expect(ids(result.current.all.data)).toEqual(["srv-1", "p1", "p2"]);
    expect(ids(result.current.news.data)).toEqual(["srv-1", "p1"]);
  });

  it("create puts the temporary row at the end of an oldest-first list whose walk is complete, and leaves one with pages to load alone", async () => {
    db.hold = (path) => path.endsWith("/records/create");
    db.seed("posts", [row("p1", { title: "one", topic: "news" }, 2), row("p2", { title: "two", topic: "sport" }, 1)]);
    const { result } = renderHook(
      () => ({
        oldest: useRecords<Post>("posts", { order: "oldest" }),
        partial: useRecords<Post>("posts", { order: "oldest", limit: 1 }),
        create: useCreateRecord<Post>("posts"),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.oldest.isSuccess && result.current.partial.isSuccess).toBe(true));
    expect(ids(result.current.oldest.data)).toEqual(["p2", "p1"]);
    expect(ids(result.current.partial.data)).toEqual(["p2"]);
    expect(result.current.partial.hasNextPage).toBe(true);

    let done!: Promise<Post>;
    act(() => {
      done = result.current.create.mutateAsync({ title: "fresh", topic: "news" });
    });
    await waitFor(() => expect(result.current.oldest.data?.[2]?.title).toBe("fresh"));
    expect(result.current.oldest.data?.[2]?.id.startsWith(TEMP_ID_PREFIX)).toBe(true);
    expect(ids(result.current.partial.data)).toEqual(["p2"]);

    (await db.waitHeld("/records/create")).release();
    await act(() => done);
    await waitFor(() => expect(ids(result.current.oldest.data)).toEqual(["p2", "p1", "srv-1"]));
  });

  it("update shows before the response, drops a row its filter no longer matches, and does not add one to a list it now matches", async () => {
    db.hold = (path) => path.endsWith("/update");
    const { result } = await writer();
    act(() => {
      result.current.update.mutate({ id: "p1", patch: { topic: "sport" } });
    });
    await waitFor(() => expect(result.current.one.data?.topic).toBe("sport"));
    expect(result.current.all.data?.find((r) => r.id === "p1")?.topic).toBe("sport");
    expect(ids(result.current.news.data)).toEqual([]);
    expect(ids(result.current.sport.data)).toEqual(["p2"]);

    (await db.waitHeld("/update")).release();
    await waitFor(() => expect(ids(result.current.sport.data)).toEqual(["p1", "p2"]));
  });

  it("delete removes the row and clears useRecord before the response", async () => {
    db.hold = (path) => path.endsWith("/delete");
    const { result } = await writer();
    act(() => {
      result.current.remove.mutate("p1");
    });
    await waitFor(() => expect(ids(result.current.all.data)).toEqual(["p2"]));
    expect(ids(result.current.news.data)).toEqual([]);
    expect(result.current.one.data).toBeUndefined();
    (await db.waitHeld("/delete")).release();
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));
    expect(ids(result.current.all.data)).toEqual(["p2"]);
  });

  it("a refused create rolls back and leaves PilelyError(404) in error", async () => {
    db.hold = (path) => path.endsWith("/records/create");
    const { result } = await writer();
    act(() => {
      result.current.create.mutate({ title: "nope" });
    });
    await waitFor(() => expect(result.current.all.data?.[0]?.title).toBe("nope"));
    (await db.waitHeld("/records/create")).refuse();
    await waitFor(() => expect(result.current.create.isError).toBe(true));
    expect(result.current.create.error).toBeInstanceOf(PilelyError);
    expect(result.current.create.error).toMatchObject({ status: 404, code: null });
    expect(ids(result.current.all.data)).toEqual(["p1", "p2"]);
    act(() => result.current.create.reset());
    await waitFor(() => expect(result.current.create.error).toBeNull());
  });

  it("a refused update and a refused delete roll back", async () => {
    db.hold = (path) => path.endsWith("/update") || path.endsWith("/delete");
    const { result } = await writer();
    act(() => {
      result.current.update.mutate({ id: "p1", patch: { topic: "sport" } });
    });
    await waitFor(() => expect(ids(result.current.news.data)).toEqual([]));
    (await db.waitHeld("/update")).refuse();
    await waitFor(() => expect(result.current.update.isError).toBe(true));
    expect(result.current.update.error).toMatchObject({ status: 404 });
    expect(ids(result.current.news.data)).toEqual(["p1"]);
    expect(result.current.one.data?.topic).toBe("news");

    act(() => {
      result.current.remove.mutate("p2");
    });
    await waitFor(() => expect(ids(result.current.all.data)).toEqual(["p1"]));
    (await db.waitHeld("/delete")).refuse();
    await waitFor(() => expect(result.current.remove.isError).toBe(true));
    expect(result.current.remove.error).toMatchObject({ status: 404 });
    expect(ids(result.current.all.data)).toEqual(["p1", "p2"]);
  });

  it("two creates in flight, the first refused: only the first's row goes", async () => {
    db.hold = (path) => path.endsWith("/records/create");
    const { result } = renderHook(
      () => ({
        all: useRecords<Post>("posts"),
        first: useCreateRecord<Post>("posts"),
        second: useCreateRecord<Post>("posts"),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.all.isSuccess).toBe(true));
    act(() => {
      result.current.first.mutate({ title: "first" });
    });
    const firstHeld = await db.waitHeld("/records/create");
    act(() => {
      result.current.second.mutate({ title: "second" });
    });
    const secondHeld = await db.waitHeld("/records/create");
    expect(result.current.all.data?.map((r) => r.title)).toEqual(["second", "first"]);

    firstHeld.refuse();
    await waitFor(() => expect(result.current.first.isError).toBe(true));
    expect(result.current.all.data?.map((r) => r.title)).toEqual(["second"]);
    expect(db.count("/records/list")).toBe(1);

    secondHeld.release();
    await waitFor(() => expect(ids(result.current.all.data)).toEqual(["srv-1"]));
  });

  it("two updates on one record, the first refused: the second's fields survive", async () => {
    db.hold = (path) => path.endsWith("/update");
    const { result } = renderHook(
      () => ({
        one: useRecord<Post>("posts", "p1"),
        a: useUpdateRecord<Post>("posts"),
        b: useUpdateRecord<Post>("posts"),
      }),
      { wrapper },
    );
    db.seed("posts", [row("p1", { title: "one", topic: "news" })]);
    await waitFor(() => expect(result.current.one.isSuccess).toBe(true));
    act(() => {
      result.current.a.mutate({ id: "p1", patch: { title: "A", topic: "A-topic" } });
    });
    const aHeld = await db.waitHeld("/update");
    act(() => {
      result.current.b.mutate({ id: "p1", patch: { title: "B" } });
    });
    const bHeld = await db.waitHeld("/update");
    expect(result.current.one.data).toMatchObject({ title: "B", topic: "A-topic" });

    aHeld.refuse();
    await waitFor(() => expect(result.current.a.isError).toBe(true));
    expect(result.current.one.data).toMatchObject({ title: "B", topic: "news" });

    bHeld.refuse();
    await waitFor(() => expect(result.current.b.isError).toBe(true));
    await waitFor(() => expect(result.current.one.data).toMatchObject({ title: "one", topic: "news" }));
  });

  it("a list fetch started before a create and answered after it does not erase the optimistic row", async () => {
    const { result } = await writer();
    db.hold = (path) => path.endsWith("/records/list") || path.endsWith("/records/create");
    act(() => {
      void result.current.all.refetch();
    });
    const staleList = await db.waitHeld("/tables/posts/records/list");
    act(() => {
      result.current.create.mutate({ title: "fresh" });
    });
    await waitFor(() => expect(result.current.all.data?.[0]?.title).toBe("fresh"));
    staleList.release();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.all.data?.[0]?.title).toBe("fresh");
    db.hold = () => false;
    (await db.waitHeld("/records/create")).release();
    await waitFor(() => expect(result.current.all.data?.[0]?.id).toBe("srv-1"));
  });

  it("the reconcile invalidation waits for every record write on the table", async () => {
    db.hold = (path) => path.endsWith("/records/create") || path.endsWith("/update");
    const { result } = await writer();
    act(() => {
      result.current.create.mutate({ title: "fresh" });
    });
    const createHeld = await db.waitHeld("/records/create");
    act(() => {
      result.current.update.mutate({ id: "p2", patch: { title: "edited" } });
    });
    const updateHeld = await db.waitHeld("/update");

    createHeld.release();
    await waitFor(() => expect(result.current.create.isSuccess).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(db.count("/records/list")).toBe(0);
    expect(result.current.all.data?.[0]?.title).toBe("fresh");
    expect(result.current.all.data?.find((r) => r.id === "p2")?.title).toBe("edited");

    updateHeld.release();
    await waitFor(() => expect(db.count("/records/list")).toBe(3));
    await waitFor(() => expect(ids(result.current.all.data)).toEqual(["srv-1", "p1", "p2"]));
  });

  it("update and delete of a temporary row send the real id once the create returns", async () => {
    db.hold = (path) => path.endsWith("/records/create");
    const { result } = await writer();
    act(() => {
      result.current.create.mutate({ title: "fresh" });
    });
    await waitFor(() => expect(result.current.all.data?.[0]?.title).toBe("fresh"));
    const tempId = result.current.all.data?.[0]?.id as string;
    act(() => {
      result.current.update.mutate({ id: tempId, patch: { title: "renamed" } });
    });
    await waitFor(() => expect(result.current.all.data?.[0]?.title).toBe("renamed"));
    expect(db.requests.some((r) => r.path.includes(TEMP_ID_PREFIX))).toBe(false);

    (await db.waitHeld("/records/create")).release();
    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    expect(db.count("/records/srv-1/update")).toBe(1);
    act(() => {
      result.current.remove.mutate(tempId);
    });
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));
    expect(db.count("/records/srv-1/delete")).toBe(1);
    expect(db.requests.some((r) => r.path.includes(TEMP_ID_PREFIX))).toBe(false);
  });

  it("update and delete of a temporary row whose create fails send nothing", async () => {
    db.hold = (path) => path.endsWith("/records/create");
    const { result } = await writer();
    act(() => {
      result.current.create.mutate({ title: "doomed" });
    });
    await waitFor(() => expect(result.current.all.data?.[0]?.title).toBe("doomed"));
    const tempId = result.current.all.data?.[0]?.id as string;
    act(() => {
      result.current.update.mutate({ id: tempId, patch: { title: "renamed" } });
      result.current.remove.mutate(tempId);
    });
    (await db.waitHeld("/records/create")).refuse();
    await waitFor(() => expect(result.current.create.isError).toBe(true));
    await waitFor(() => expect(result.current.update.isError).toBe(true));
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));
    expect(db.count("/update")).toBe(0);
    expect(db.count("/delete")).toBe(0);
    await waitFor(() => expect(ids(result.current.all.data)).toEqual(["p1", "p2"]));
  });

  it.each(["release", "refuse"] as const)("sign-out mid-write keeps the cache cleared after the write settles (%s)", async (outcome) => {
    db.hold = (path) => path.endsWith("/records/create");
    const { result } = await writer();
    const hidden = renderHook(() => useRecords<Post>("drafts"), { wrapper });
    await waitFor(() => expect(hidden.result.current.isSuccess).toBe(true));
    hidden.unmount();

    act(() => {
      result.current.create.mutate({ title: "mine" });
    });
    await waitFor(() => expect(result.current.all.data?.[0]?.title).toBe("mine"));
    act(() => result.current.auth.signOut());
    expect(queryClient.getQueryData(["pilely", "simple-db", "records", "drafts", "list", {}])).toBeUndefined();
    expect(queryClient.getQueryCache().findAll({ queryKey: ["pilely", "simple-db", "records", "drafts"] })).toHaveLength(0);
    expect(result.current.all.data).toBeUndefined();
    await waitFor(() => expect(ids(result.current.all.data)).toEqual(["p1", "p2"]));

    const write = await db.waitHeld("/records/create");
    if (outcome === "release") write.release();
    else write.refuse();
    await waitFor(() => expect(result.current.create.isPending).toBe(false));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(result.current.all.data?.some((r) => r.id.startsWith(TEMP_ID_PREFIX))).toBe(false);
    expect(queryClient.getQueryCache().findAll({ queryKey: ["pilely", "simple-db", "records", "drafts"] })).toHaveLength(0);
    expect(ids(result.current.news.data)).toEqual(["p1"]);
  });

  it("{ optimistic: false } changes nothing in the cache until the server answers", async () => {
    db.hold = (path) => /\/(create|update|delete)$/.test(path);
    const { result } = await writer({ optimistic: false });
    const before = queryClient.getQueryCache().getAll().map((q) => q.state.dataUpdatedAt);
    act(() => {
      result.current.create.mutate({ title: "late" });
      result.current.update.mutate({ id: "p1", patch: { title: "late" } });
      result.current.remove.mutate("p2");
    });
    await waitFor(() => expect(db.held).toHaveLength(3));
    expect(ids(result.current.all.data)).toEqual(["p1", "p2"]);
    expect(result.current.one.data?.title).toBe("one");
    expect(queryClient.getQueryCache().getAll().map((q) => q.state.dataUpdatedAt)).toEqual(before);
    for (const held of db.held.splice(0)) held.release();
    await waitFor(() => expect(result.current.all.data?.map((r) => r.title)).toEqual(["late", "late"]));
  });
});

describe("conditional record writes", () => {
  interface Counter extends DbRecord {
    title: string | null;
    topic: string | null;
    likes: number | null;
  }

  function bodyOf(fragment: string): Record<string, unknown> | undefined {
    return db.requests.find((r) => r.path.includes(fragment))?.body;
  }

  function conflict(code: string, extra: Record<string, unknown> = {}): Reply {
    return { status: 409, body: { ok: false, code, reason: "refused", ...extra } };
  }

  async function seeded<T>(hook: () => T, ready: (value: T) => boolean) {
    db.seed("posts", [row("p1", { title: "one", topic: "news" }, 2), row("p2", { title: "two", topic: "sport" }, 1)]);
    const rendered = renderHook(hook, { wrapper });
    await waitFor(() => expect(ready(rendered.result.current)).toBe(true));
    db.requests = [];
    return rendered;
  }

  it("useRecord sends {} by default and { consistent: true } when asked", async () => {
    db.seed("posts", [row("p1", { title: "one" })]);
    db.seed("strong", [row("p1", { title: "fresh" })]);
    const { result } = renderHook(
      () => ({
        plain: useRecord<Post>("posts", "p1"),
        strong: useRecord<Post>("strong", "p1", { consistent: true }),
      }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.plain.isSuccess && result.current.strong.isSuccess).toBe(true));
    expect(result.current.strong.data?.title).toBe("fresh");
    expect(bodyOf("/posts/records/p1/get")).toEqual({});
    expect(bodyOf("/strong/records/p1/get")).toEqual({ consistent: true });
  });

  it("useCreateRecord sends a fixed or derived key, and its optimistic row carries _key and _version 1", async () => {
    db.hold = (path) => path.endsWith("/records/create");
    const { result } = await seeded(
      () => ({
        all: useRecords<Post>("posts"),
        fixed: useCreateRecord<Post>("posts", { key: "settings" }),
        derived: useCreateRecord<Post>("posts", { key: (fields) => (fields.topic ? `topic:${fields.topic}` : undefined) }),
        plain: useCreateRecord<Post>("posts"),
      }),
      (c) => c.all.isSuccess,
    );
    act(() => {
      result.current.fixed.mutate({ title: "s" });
    });
    await waitFor(() => expect(result.current.all.data?.[0]?.title).toBe("s"));
    expect(result.current.all.data?.[0]).toMatchObject({ _key: "settings", _version: 1 });
    expect((await db.waitHeld("/records/create")).body).toEqual({ fields: { title: "s" }, key: "settings" });

    act(() => {
      result.current.derived.mutate({ title: "d", topic: "news" });
      result.current.derived.mutate({ title: "none" });
      result.current.plain.mutate({ title: "p" });
    });
    await waitFor(() => expect(db.held).toHaveLength(3));
    expect(db.held.map((h) => h.body)).toEqual([
      { fields: { title: "d", topic: "news" }, key: "topic:news" },
      { fields: { title: "none" } },
      { fields: { title: "p" } },
    ]);
    for (const held of db.held.splice(0)) held.release();
  });

  it("a keyed create answered 409 key_exists rolls back and leaves the existing row's id on the error", async () => {
    db.hold = (path) => path.endsWith("/records/create");
    db.override = (path) => (path.endsWith("/records/create") ? conflict("key_exists", { id: "p1" }) : null);
    const { result } = await seeded(
      () => ({ all: useRecords<Post>("posts"), create: useCreateRecord<Post>("posts", { key: "evt_1" }) }),
      (c) => c.all.isSuccess,
    );
    act(() => {
      result.current.create.mutate({ title: "dup" });
    });
    await waitFor(() => expect(result.current.all.data?.[0]?.title).toBe("dup"));
    (await db.waitHeld("/records/create")).release();
    await waitFor(() => expect(result.current.create.isError).toBe(true));
    const error = result.current.create.error;
    expect(error).toBeInstanceOf(PilelyError);
    expect(error).toMatchObject({ status: 409, code: "key_exists", id: "p1" });
    expect(ids(result.current.all.data)).toEqual(["p1", "p2"]);
  });

  it("useUpdateRecord sends ifVersion, if and inc; a 409 version_conflict rolls the patch back and exposes currentVersion", async () => {
    db.hold = (path) => path.endsWith("/update");
    db.override = (path) => (path.endsWith("/update") ? conflict("version_conflict", { current_version: 3 }) : null);
    const { result } = await seeded(
      () => ({ one: useRecord<Counter>("posts", "p1"), update: useUpdateRecord<Counter>("posts") }),
      (c) => c.one.isSuccess,
    );
    act(() => {
      result.current.update.mutate({
        id: "p1",
        patch: { title: "edited" },
        ifVersion: 2,
        if: { topic: "news" },
        inc: { likes: 1 },
      });
    });
    await waitFor(() => expect(result.current.one.data?.title).toBe("edited"));
    const held = await db.waitHeld("/update");
    expect(held.body).toEqual({ fields: { title: "edited" }, inc: { likes: 1 }, if_version: 2, if: { topic: "news" } });
    held.release();
    await waitFor(() => expect(result.current.update.isError).toBe(true));
    expect(result.current.update.error).toMatchObject({ status: 409, code: "version_conflict", currentVersion: 3 });
    expect(result.current.one.data?.title).toBe("one");
  });

  it("an inc-only update sends fields: {} and changes nothing in the cache until the refresh lands", async () => {
    db.hold = (path) => path.endsWith("/update");
    db.override = (path, body) => {
      if (!path.endsWith("/p1/update")) return null;
      const inc = body.inc as Record<string, number>;
      return { status: 200, body: { ok: true, record: { ...row("p1", { title: "one" }), likes: inc.likes } } };
    };
    const { result } = await seeded(
      () => ({ one: useRecord<Counter>("posts", "p1"), update: useUpdateRecord<Counter>("posts") }),
      (c) => c.one.isSuccess,
    );
    const before = queryClient.getQueryCache().getAll().map((q) => q.state.dataUpdatedAt);
    act(() => {
      result.current.update.mutate({ id: "p1", patch: {}, inc: { likes: 2 } });
    });
    const held = await db.waitHeld("/update");
    expect(held.body).toEqual({ fields: {}, inc: { likes: 2 } });
    expect(queryClient.getQueryCache().getAll().map((q) => q.state.dataUpdatedAt)).toEqual(before);
    held.release();
    await waitFor(() => expect(result.current.update.isSuccess).toBe(true));
    await waitFor(() => expect(db.count("/p1/get")).toBe(1));
  });

  it("useDeleteRecord sends if_version for { id, ifVersion } and {} for a bare id; a 409 puts the row back", async () => {
    db.hold = (path) => path.endsWith("/delete");
    const { result } = await seeded(
      () => ({ all: useRecords<Post>("posts"), remove: useDeleteRecord("posts") }),
      (c) => c.all.isSuccess,
    );
    db.override = (path) => (path.endsWith("/p1/delete") ? conflict("version_conflict", { current_version: 4 }) : null);
    act(() => {
      result.current.remove.mutate({ id: "p1", ifVersion: 2 });
    });
    await waitFor(() => expect(ids(result.current.all.data)).toEqual(["p2"]));
    const conditional = await db.waitHeld("/p1/delete");
    expect(conditional.body).toEqual({ if_version: 2 });
    conditional.release();
    await waitFor(() => expect(result.current.remove.isError).toBe(true));
    expect(result.current.remove.error).toMatchObject({ code: "version_conflict", currentVersion: 4 });
    await waitFor(() => expect(ids(result.current.all.data)).toEqual(["p1", "p2"]));

    act(() => {
      result.current.remove.mutate("p2");
    });
    const bare = await db.waitHeld("/p2/delete");
    expect(bare.body).toEqual({});
    bare.release();
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));
    await waitFor(() => expect(ids(result.current.all.data)).toEqual(["p1"]));
  });
});

describe("outside the provider", () => {
  it.each<[string, () => unknown]>([
    ["useRecords", () => useRecords("posts")],
    ["useRecord", () => useRecord("posts", "x")],
    ["useCreateRecord", () => useCreateRecord("posts")],
    ["useUpdateRecord", () => useUpdateRecord("posts")],
    ["useDeleteRecord", () => useDeleteRecord("posts")],
    ["useTables", () => useTables()],
    ["useCreateTable", () => useCreateTable()],
    ["useAddColumn", () => useAddColumn()],
    ["useSetTableAccess", () => useSetTableAccess()],
    ["useSetNewRowEmail", () => useSetNewRowEmail()],
    ["useDbApps", () => useDbApps()],
    ["useCreateDbApp", () => useCreateDbApp()],
    ["useDeleteDbApp", () => useDeleteDbApp()],
  ])("%s throws the named error", (name, hook) => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(hook)).toThrow(`${name} must be used inside <PilelyProvider>`);
    spy.mockRestore();
  });
});

describe("client.js absent", () => {
  it("a data hook reports the not-loaded error without throwing", async () => {
    delete window.pilely;
    const { result } = renderHook(() => useRecords<Post>("posts"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toMatch(/pilely client not loaded/);
  });
});
