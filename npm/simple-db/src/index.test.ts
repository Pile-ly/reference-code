import { afterEach, describe, expect, it, vi } from "vitest";
import type { PilelyClient } from "@pilely/core";
import {
  addColumn,
  createApp,
  createRecord,
  createTable,
  deleteRecord,
  getRecord,
  listAllRecords,
  listApps,
  listRecords,
  listTables,
  setTableAccess,
  updateRecord,
} from "./index.js";

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

  it("covers exactly the 11 registered routes", () => {
    expect(cases).toHaveLength(11);
  });
});

describe("createRecord / getRecord", () => {
  it("sends {fields} nested and returns the flat record", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { ok: true, record: { id: "r1", title: "hi", _submitter_handle: "a", _created_at_ms: 1, _updated_at_ms: 1 } }),
    );
    stubWindow(fetchImpl);
    const record = await createRecord("posts", { title: "hi" });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ fields: { title: "hi" } });
    expect(record).toEqual({ id: "r1", title: "hi", _submitter_handle: "a", _created_at_ms: 1, _updated_at_ms: 1 });
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
});

describe("setTableAccess", () => {
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
