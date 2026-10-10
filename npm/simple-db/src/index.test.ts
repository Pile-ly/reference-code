import { afterEach, describe, expect, it, vi } from "vitest";
import type { PilelyClient } from "@pilely/core";
import {
  addColumn,
  createApp,
  createRecord,
  createTable,
  deleteApp,
  deleteRecord,
  getRecord,
  listAllRecords,
  listApps,
  listRecords,
  listTables,
  setNewRowEmail,
  setTableAccess,
  updateRecord,
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

describe("simple-db: every route maps to the correct URL", () => {
  const base = "https://simple-db.pilely.app/apps/app-1";

  const cases: [string, () => Promise<unknown>, string][] = [
    ["listApps", () => listApps(), "https://simple-db.pilely.app/apps/list"],
    ["createApp", () => createApp(), `${base}/create`],
    ["deleteApp", () => deleteApp(), `${base}/delete`],
    [
      "createTable",
      () => createTable({ table: "posts", columns: [], read_group: null, write_group: null }),
      `${base}/tables/create`,
    ],
    ["listTables", () => listTables(), `${base}/tables/list`],
    [
      "setTableAccess",
      () => setTableAccess("posts", { read_group: null, write_group: null }),
      `${base}/tables/posts/access/set`,
    ],
    [
      "setNewRowEmail",
      () => setNewRowEmail("posts", "each"),
      `${base}/tables/posts/notify/set`,
    ],
    [
      "addColumn",
      () => addColumn("posts", { name: "title", type: "text" }),
      `${base}/tables/posts/columns/add`,
    ],
    [
      "createRecord",
      () => createRecord("posts", { title: "hi" }),
      `${base}/tables/posts/records/create`,
    ],
    ["listRecords", () => listRecords("posts"), `${base}/tables/posts/records/list`],
    [
      "getRecord",
      () => getRecord("posts", "rec-1"),
      `${base}/tables/posts/records/rec-1/get`,
    ],
    [
      "updateRecord",
      () => updateRecord("posts", "rec-1", { title: "hi" }),
      `${base}/tables/posts/records/rec-1/update`,
    ],
    [
      "deleteRecord",
      () => deleteRecord("posts", "rec-1"),
      `${base}/tables/posts/records/rec-1/delete`,
    ],
  ];

  it.each(cases)("%s hits the correct path", async (_name, run, expectedUrl) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    stubWindow(fetchImpl);
    await run();
    expect(urlOf(fetchImpl)).toBe(expectedUrl);
  });

  it("covers exactly the 13 registered routes", () => {
    expect(cases).toHaveLength(13);
  });
});

describe("createRecord / getRecord", () => {
  it("sends {fields} nested and returns the flat record", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        record: { id: "r1", title: "hi", _submitter_handle: "a", _created_at_ms: 1, _updated_at_ms: 1, _version: 1, _key: null },
      }),
    );
    stubWindow(fetchImpl);
    const record = await createRecord("posts", { title: "hi" });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ fields: { title: "hi" } });
    expect(record).toEqual({
      id: "r1",
      title: "hi",
      _submitter_handle: "a",
      _created_at_ms: 1,
      _updated_at_ms: 1,
      _version: 1,
      _key: null,
    });
  });
});

describe("record options", () => {
  function bodies(fetchImpl: ReturnType<typeof vi.fn>): unknown[] {
    return fetchImpl.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string));
  }

  it("calls without options send no option fields", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, record: { id: "r1" }, deleted: "r1" }));
    stubWindow(fetchImpl);
    await createRecord("posts", { title: "hi" });
    await getRecord("posts", "r1");
    await updateRecord("posts", "r1", { title: "ho" });
    await deleteRecord("posts", "r1");
    await createRecord("posts", { title: "hi" }, {});
    await getRecord("posts", "r1", {});
    await updateRecord("posts", "r1", { title: "ho" }, {});
    await deleteRecord("posts", "r1", {});
    const plain = [{ fields: { title: "hi" } }, {}, { fields: { title: "ho" } }, {}];
    expect(bodies(fetchImpl)).toEqual([...plain, ...plain]);
  });

  it("sends key, consistent, if_version, if and inc under their wire names when given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, record: { id: "r1" }, deleted: "r1" }));
    stubWindow(fetchImpl);
    await createRecord("events", { kind: "paid" }, { key: "evt_1" });
    await getRecord("events", "r1", { consistent: true });
    await updateRecord("events", "r1", { holder: "a" }, { ifVersion: 3, if: { holder: null } });
    await updateRecord("events", "r1", {}, { inc: { total: 1 } });
    await deleteRecord("events", "r1", { ifVersion: 4 });
    expect(bodies(fetchImpl)).toEqual([
      { fields: { kind: "paid" }, key: "evt_1" },
      { consistent: true },
      { fields: { holder: "a" }, if_version: 3, if: { holder: null } },
      { fields: {}, inc: { total: 1 } },
      { if_version: 4 },
    ]);
  });

  it("throws the three 409s as PilelyError with id or currentVersion", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(409, { ok: false, code: "key_exists", reason: "r", id: "row-1" }))
      .mockResolvedValueOnce(
        jsonResponse(409, { ok: false, code: "version_conflict", reason: "r", current_version: 5 }),
      )
      .mockResolvedValueOnce(jsonResponse(409, { ok: false, code: "condition_failed", reason: "r" }))
      .mockResolvedValueOnce(
        jsonResponse(409, { ok: false, code: "version_conflict", reason: "r", current_version: 2 }),
      );
    stubWindow(fetchImpl);
    await expect(createRecord("events", {}, { key: "k" })).rejects.toMatchObject({
      status: 409,
      code: "key_exists",
      id: "row-1",
    });
    await expect(updateRecord("events", "r1", { a: 1 }, { ifVersion: 1 })).rejects.toMatchObject({
      code: "version_conflict",
      currentVersion: 5,
    });
    await expect(updateRecord("events", "r1", { a: 1 }, { if: { a: null } })).rejects.toMatchObject({
      code: "condition_failed",
      id: undefined,
      currentVersion: undefined,
    });
    await expect(deleteRecord("events", "r1", { ifVersion: 1 })).rejects.toMatchObject({
      code: "version_conflict",
      currentVersion: 2,
    });
  });
});

describe("listAllRecords", () => {
  it("walks a two-page cursor to the end, sending limit: 100 on every page", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, records: [{ id: "1" }], next_cursor: "c1" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, records: [{ id: "2" }], next_cursor: null }));
    stubWindow(fetchImpl);
    const rows = await listAllRecords("posts");
    expect(rows).toEqual([{ id: "1" }, { id: "2" }]);
    for (const call of fetchImpl.mock.calls) {
      const init = call[1] as RequestInit;
      expect(JSON.parse(init.body as string).limit).toBe(100);
    }
  });

  it("keeps walking through a short page and an empty page while the cursor is non-null, ending only on null", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, records: [{ id: "1" }], next_cursor: "c1" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, records: [], next_cursor: "c2" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, records: [{ id: "2" }], next_cursor: "c3" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, records: [], next_cursor: null }));
    stubWindow(fetchImpl);
    const rows = await listAllRecords("posts", { topic: "news" });
    expect(rows).toEqual([{ id: "1" }, { id: "2" }]);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    const bodies = fetchImpl.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string));
    expect(bodies).toEqual([
      { limit: 100, eq: { topic: "news" } },
      { limit: 100, cursor: "c1", eq: { topic: "news" } },
      { limit: 100, cursor: "c2", eq: { topic: "news" } },
      { limit: 100, cursor: "c3", eq: { topic: "news" } },
    ]);
  });

  it("walks oldest first when asked, sending order on every page", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, records: [], next_cursor: "o:1:a" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, records: [{ id: "1" }], next_cursor: null }));
    stubWindow(fetchImpl);
    const rows = await listAllRecords("posts", undefined, { order: "oldest" });
    expect(rows).toEqual([{ id: "1" }]);
    const bodies = fetchImpl.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string));
    expect(bodies).toEqual([
      { limit: 100, order: "oldest" },
      { limit: 100, cursor: "o:1:a", order: "oldest" },
    ]);
  });
});

describe("listRecords", () => {
  it("sends order when given and leaves it out otherwise", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, records: [], next_cursor: null }));
    stubWindow(fetchImpl);
    await listRecords("posts", { limit: 10, order: "oldest" });
    await listRecords("posts", { limit: 10 });
    const bodies = fetchImpl.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string));
    expect(bodies).toEqual([{ limit: 10, order: "oldest" }, { limit: 10 }]);
  });

  it("sends eq on _submitter_user_id as given, beside column filters", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, records: [], next_cursor: null }));
    stubWindow(fetchImpl);
    const userId = "6f1c2a9e-3b4d-4e5f-8a6b-7c8d9e0f1a2b";
    await listRecords("posts", { limit: 10, eq: { _submitter_user_id: userId, topic: "news" } });
    await listAllRecords("posts", { _submitter_user_id: userId });
    const bodies = fetchImpl.mock.calls.map((call) => JSON.parse((call[1] as RequestInit).body as string));
    expect(bodies).toEqual([
      { limit: 10, eq: { _submitter_user_id: userId, topic: "news" } },
      { limit: 100, eq: { _submitter_user_id: userId } },
    ]);
  });

  it("returns a short page with its non-null cursor as the server sent it", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, records: [], next_cursor: "5:x" }));
    stubWindow(fetchImpl);
    expect(await listRecords("posts", { limit: 10, eq: { topic: "news" } })).toEqual({
      records: [],
      next_cursor: "5:x",
    });
  });
});

describe("listTables / listApps", () => {
  const table = { name: "posts", read_group: null, write_group: null, anon_read: false, created_at_ms: 1, columns: [] };
  const app = { app_id: "app-1", owner_handle: "alice", created_time_stamp: 1 };

  it("listTables sends limit and cursor as the body and returns { tables, nextCursor }", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, tables: [table], next_cursor: "1:posts" }));
    stubWindow(fetchImpl);
    const page = await listTables({ limit: 1, cursor: "0:a" });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ limit: 1, cursor: "0:a" });
    expect(page).toEqual({ tables: [table], nextCursor: "1:posts" });
  });

  it("listApps sends limit and cursor as the body and returns { apps, nextCursor }", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, apps: [app], next_cursor: null }));
    stubWindow(fetchImpl);
    const page = await listApps({ limit: 5, cursor: "9:app-2" });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ limit: 5, cursor: "9:app-2" });
    expect(page).toEqual({ apps: [app], nextCursor: null });
  });

  it("with no params both send {} — the first page", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, tables: [], next_cursor: null }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, apps: [], next_cursor: null }));
    stubWindow(fetchImpl);
    expect(await listTables()).toEqual({ tables: [], nextCursor: null });
    expect(await listApps()).toEqual({ apps: [], nextCursor: null });
    for (const call of fetchImpl.mock.calls) {
      expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({});
    }
  });
});

const ROW_ACCESS = {
  read_scope: "own",
  audience_column: "to_user_id",
  mutate_scope: "own",
  mutate_group: "staffGroup1",
  deny_group: "banGroup1",
} as const;

describe("createTable: row-level settings", () => {
  it("sends the five settings it is given and returns the table object carrying them", async () => {
    const table = {
      name: "messages",
      read_group: null,
      write_group: null,
      anon_read: false,
      ...ROW_ACCESS,
      created_at_ms: 1,
      columns: [{ name: "to_user_id", type: "text" }],
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, table }));
    stubWindow(fetchImpl);
    const created = await createTable({
      table: "messages",
      columns: [{ name: "to_user_id", type: "text" }],
      read_group: null,
      write_group: null,
      ...ROW_ACCESS,
    });
    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toEqual({
      table: "messages",
      columns: [{ name: "to_user_id", type: "text" }],
      read_group: null,
      write_group: null,
      ...ROW_ACCESS,
    });
    expect(created).toEqual(table);
  });

  it("sends none of the five when none is given", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, table: { name: "posts" } }));
    stubWindow(fetchImpl);
    await createTable({ table: "posts", columns: [], read_group: null, write_group: null });
    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(Object.keys(body).sort()).toEqual(["columns", "read_group", "table", "write_group"]);
  });
});

describe("setTableAccess", () => {
  it("sends only the row-level keys it is given and returns all five from the reply", async () => {
    const reply = { ok: true, table: "messages", read_group: null, write_group: "writers1", anon_read: false, ...ROW_ACCESS };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, reply));
    stubWindow(fetchImpl);
    const access = await setTableAccess("messages", {
      read_group: null,
      write_group: "writers1",
      read_scope: "own",
      deny_group: "banGroup1",
    });
    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toEqual({ read_group: null, write_group: "writers1", read_scope: "own", deny_group: "banGroup1" });
    expect(access).toEqual({
      table: "messages",
      read_group: null,
      write_group: "writers1",
      anon_read: false,
      ...ROW_ACCESS,
    });
  });

  it("sends an explicit null for a group it clears", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, table: "posts" }));
    stubWindow(fetchImpl);
    await setTableAccess("posts", { read_group: null, write_group: null, mutate_group: null });
    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toEqual({ read_group: null, write_group: null, mutate_group: null });
  });

  it("emits both read_group and write_group even when null", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { ok: true, table: "posts", read_group: null, write_group: null, anon_read: false }),
    );
    stubWindow(fetchImpl);
    await setTableAccess("posts", { read_group: null, write_group: null });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(Object.keys(body)).toEqual(expect.arrayContaining(["read_group", "write_group"]));
    expect(body.read_group).toBeNull();
    expect(body.write_group).toBeNull();
  });
});

describe("setNewRowEmail", () => {
  it("sends {new_row_email} and returns the table name and its value from the reply", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ok: true, table: "inbox", new_row_email: "daily", extra: 1 }));
    stubWindow(fetchImpl);
    const answer = await setNewRowEmail("inbox", "daily");
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ new_row_email: "daily" });
    expect(answer).toEqual({ table: "inbox", new_row_email: "daily" });
  });

  it.each(["off", "each", "daily"] as const)("sends %s as given", async (value) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, table: "inbox", new_row_email: value }));
    stubWindow(fetchImpl);
    expect(await setNewRowEmail("inbox", value)).toEqual({ table: "inbox", new_row_email: value });
    expect(JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string)).toEqual({ new_row_email: value });
  });

  it.each([
    [400, "email_not_ready"],
    [503, "email_check_unavailable"],
    [503, "out_of_traffic_credits"],
  ] as const)("throws a %i %s refusal with its code", async (status, code) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(status, { ok: false, code, reason: "no" }));
    stubWindow(fetchImpl);
    await expect(setNewRowEmail("inbox", "each")).rejects.toMatchObject({ status, code });
  });
});

describe("table objects carry new_row_email", () => {
  const table = {
    name: "inbox",
    read_group: null,
    write_group: null,
    anon_read: false,
    read_scope: "all",
    audience_column: null,
    mutate_scope: "owner",
    mutate_group: null,
    deny_group: null,
    new_row_email: "each",
    created_at_ms: 1,
    columns: [],
  };

  it("createTable, listTables and addColumn pass it through", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, table: { ...table, new_row_email: "off" } }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, tables: [table], next_cursor: null }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, table: { ...table, new_row_email: "daily" } }));
    stubWindow(fetchImpl);
    expect((await createTable({ table: "inbox", columns: [], read_group: null, write_group: null })).new_row_email).toBe(
      "off",
    );
    expect((await listTables()).tables[0]?.new_row_email).toBe("each");
    expect((await addColumn("inbox", { name: "body", type: "text" })).new_row_email).toBe("daily");
  });
});

describe("deleteApp", () => {
  it("returns the bare app_id, not a DbApp — the row is gone", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, app_id: "app-1" }));
    stubWindow(fetchImpl);
    const appId = await deleteApp();
    expect(appId).toBe("app-1");
  });

  it("omits pile_row_exists by default, letting the service default to true", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, app_id: "app-1" }));
    stubWindow(fetchImpl);
    await deleteApp();
    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toEqual({});
  });

  it("sends pile_row_exists: false for the account-deletion sweep", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, app_id: "app-1" }));
    stubWindow(fetchImpl);
    await deleteApp({ pile_row_exists: false });
    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toEqual({ pile_row_exists: false });
  });
});
