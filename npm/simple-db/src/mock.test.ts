import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock mode is a build-time switch read when modules load, so it is set
// before any import below is evaluated.
vi.hoisted(() => {
  vi.stubEnv("VITE_PILELY_MOCK", "1");
});

import { appId, PilelyError, resetMock, seedMock } from "@pilely/core";
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
  setTableAccess,
  updateRecord,
} from "./api.js";
import type { DbRecord } from "./types.js";

interface Post extends DbRecord {
  title: string | null;
  likes: number | null;
}

let globalFetchSpy: ReturnType<typeof vi.fn>;

function pilely(): PilelyClient {
  const client = (globalThis as { window?: { pilely?: PilelyClient } }).window?.pilely;
  if (!client) throw new Error("window.pilely is not set");
  return client;
}

beforeEach(async () => {
  (globalThis as { window?: unknown }).window = {};
  globalFetchSpy = vi.fn();
  (globalThis as { fetch?: unknown }).fetch = globalFetchSpy;
  resetMock();
  // Any core call puts the mock runtime on window.pilely; app code then
  // signs in through it exactly as it would through client.js.
  appId();
  await pilely().signIn();
});

afterEach(() => {
  expect(globalFetchSpy).not.toHaveBeenCalled();
  resetMock();
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { fetch?: unknown }).fetch;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("simple-db fake: records", () => {
  it("create → list → get → update → delete through the real wrapper", async () => {
    const created = await createRecord<Post>("posts", { title: "hi", likes: 1 });
    expect(created).toEqual({
      id: expect.any(String),
      title: "hi",
      likes: 1,
      _submitter_user_id: "mock-user",
      _submitter_handle: "mock_user",
      _created_at_ms: expect.any(Number),
      _updated_at_ms: created._created_at_ms,
    });

    const page = await listRecords<Post>("posts");
    expect(page).toEqual({ records: [created], next_cursor: null });

    expect(await getRecord<Post>("posts", created.id)).toEqual(created);

    const updated = await updateRecord<Post>("posts", created.id, { title: "edited" });
    expect(updated.title).toBe("edited");
    expect(updated.likes).toBe(1);
    expect(updated._updated_at_ms).toBeGreaterThan(created._updated_at_ms);

    expect(await deleteRecord("posts", created.id)).toBe(created.id);
    await expect(getRecord("posts", created.id)).rejects.toMatchObject({ status: 404, code: null });
    await expect(getRecord("posts", created.id)).rejects.toBeInstanceOf(PilelyError);
  });

  it("renders every column, null where a record never set it", async () => {
    await createRecord("posts", { title: "a" });
    const second = await createRecord<Post>("posts", { likes: 2 });
    expect(second.title).toBeNull();
    const [newest, oldest] = (await listRecords<Post>("posts")).records;
    expect(newest?.likes).toBe(2);
    expect(oldest?.likes).toBeNull();
  });

  it("pages newest first and hands a cursor back only when more rows exist", async () => {
    for (let i = 0; i < 3; i += 1) {
      await createRecord("posts", { title: `p${i}` });
    }
    const first = await listRecords<Post>("posts", { limit: 2 });
    expect(first.records.map((r) => r.title)).toEqual(["p2", "p1"]);
    expect(first.next_cursor).toEqual(expect.stringMatching(/^\d+:/));
    const second = await listRecords<Post>("posts", { limit: 2, cursor: first.next_cursor ?? "" });
    expect(second.records.map((r) => r.title)).toEqual(["p0"]);
    expect(second.next_cursor).toBeNull();

    const full = await listRecords<Post>("posts", { limit: 3 });
    expect(full.next_cursor).toBeNull();

    const all = await listAllRecords<Post>("posts");
    expect(all.map((r) => r.title)).toEqual(["p2", "p1", "p0"]);
    expect((await listAllRecords<Post>("posts", { title: "p1" })).map((r) => r.title)).toEqual(["p1"]);
  });

  it("refuses an out-of-range limit with the service's 400", async () => {
    await expect(listRecords("posts", { limit: 101 })).rejects.toMatchObject({
      status: 400,
      code: "bad_request",
    });
  });

  it("refuses a signed-out write with the bare 404, then accepts it after signIn", async () => {
    pilely().signOut();
    await expect(createRecord("posts", { title: "x" })).rejects.toMatchObject({
      status: 404,
      code: null,
      reason: "simple-db answered 404",
    });
    await expect(createRecord("posts", { title: "x" })).rejects.toBeInstanceOf(PilelyError);
    await pilely().signIn();
    await expect(createRecord<Post>("posts", { title: "x" })).resolves.toMatchObject({ title: "x" });
  });
});

describe("simple-db fake: provisioning", () => {
  it("creates tables on first use and answers the table routes in the real shapes", async () => {
    expect(await listTables()).toEqual([]);
    await createRecord("notes", { body: "x", done: false, rank: 1.5, meta: { a: 1 } });
    const [notes] = await listTables();
    expect(notes).toEqual({
      name: "notes",
      read_group: null,
      write_group: null,
      anon_read: false,
      created_at_ms: expect.any(Number),
      columns: [
        { name: "body", type: "text" },
        { name: "done", type: "boolean" },
        { name: "rank", type: "real" },
        { name: "meta", type: "json" },
      ],
    });

    const table = await createTable({
      table: "posts",
      columns: [{ name: "title", type: "text" }],
      read_group: null,
      write_group: null,
    });
    expect(table.columns).toEqual([{ name: "title", type: "text" }]);
    await expect(
      createTable({ table: "posts", columns: [], read_group: null, write_group: null }),
    ).rejects.toMatchObject({ status: 409, code: "table_exists" });

    const withColumn = await addColumn("posts", { name: "likes", type: "integer", default: 0 });
    expect(withColumn.columns.map((c) => c.name)).toEqual(["title", "likes"]);
    await expect(addColumn("posts", { name: "likes", type: "integer" })).rejects.toMatchObject({
      status: 409,
      code: "column_exists",
    });

    expect(await setTableAccess("posts", { read_group: null, write_group: "g1" })).toEqual({
      table: "posts",
      read_group: null,
      write_group: "g1",
      anon_read: false,
    });
  });

  it("answers the app routes in the real shapes", async () => {
    const app = await createApp();
    expect(app).toEqual({ app_id: "mock-app", owner_handle: "mock_user", created_time_stamp: expect.any(Number) });
    await expect(createApp()).rejects.toMatchObject({ status: 409, code: "db_already_exists" });
    expect(await listApps()).toEqual([app]);
    expect(await deleteApp()).toBe("mock-app");
    expect(await listApps()).toEqual([]);
    await expect(deleteApp()).rejects.toMatchObject({ status: 404, code: null });
  });

  it("seeds rows per table once", async () => {
    resetMock();
    seedMock({ signedIn: true, tables: { posts: [{ title: "seeded" }] } });
    expect(pilely().user()).not.toBeNull();
    const rows = await listAllRecords<Post>("posts");
    expect(rows.map((r) => r.title)).toEqual(["seeded"]);
    await deleteRecord("posts", rows[0]?.id ?? "");
    seedMock({ signedIn: true, tables: { posts: [{ title: "seeded" }] } });
    expect(await listAllRecords("posts")).toEqual([]);
  });
});
