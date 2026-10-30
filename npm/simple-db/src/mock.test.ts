import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock mode is a build-time switch read when modules load, so it is set
// before any import below is evaluated.
vi.hoisted(() => {
  vi.stubEnv("VITE_PILELY_MOCK", "1");
});

import { appId, call, PilelyError, resetMock, seedMock } from "@pilely/core";
import type { MockReply, MockServiceContext, PilelyClient, PilelyUser } from "@pilely/core";
import {
  addColumn,
  createApp,
  createRecord,
  createTable,
  deleteApp,
  deleteRecord,
  downloadFile,
  getRecord,
  listAllRecords,
  listApps,
  listRecords,
  listTables,
  setNewRowEmail,
  setTableAccess,
  updateRecord,
} from "./api.js";
import { createSimpleDbFake, MOCK_UPLOAD_PATH } from "./mock.js";
import type { DbFile, DbListPage, DbRecord, DbUploadTicket } from "./types.js";

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
      _version: 1,
      _key: null,
    });

    const page = await listRecords<Post>("posts");
    expect(page).toEqual({ records: [created], next_cursor: null });

    expect(await getRecord<Post>("posts", created.id)).toEqual(created);

    const updated = await updateRecord<Post>("posts", created.id, { title: "edited" });
    expect(updated.title).toBe("edited");
    expect(updated.likes).toBe(1);
    expect(updated._updated_at_ms).toBeGreaterThan(created._updated_at_ms);
    expect(updated._version).toBe(2);

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
    expect(first.next_cursor).toEqual(expect.stringMatching(/^m2\./));
    const second = await listRecords<Post>("posts", { limit: 2, cursor: first.next_cursor ?? "" });
    expect(second.records.map((r) => r.title)).toEqual(["p0"]);
    expect(second.next_cursor).toBeNull();

    const full = await listRecords<Post>("posts", { limit: 3 });
    expect(full.next_cursor).toBeNull();

    const all = await listAllRecords<Post>("posts");
    expect(all.map((r) => r.title)).toEqual(["p2", "p1", "p0"]);
    expect((await listAllRecords<Post>("posts", { title: "p1" })).map((r) => r.title)).toEqual(["p1"]);
  });

  it("pages oldest first with an oldest cursor, each row exactly once, eq included", async () => {
    for (let i = 0; i < 5; i += 1) {
      await createRecord("posts", { title: `p${i}`, likes: i % 2 });
    }
    const first = await listRecords<Post>("posts", { limit: 2, order: "oldest" });
    expect(first.records.map((r) => r.title)).toEqual(["p0", "p1"]);
    expect(first.next_cursor).toEqual(expect.stringMatching(/^m2\./));

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: DbListPage<Post> = await listRecords<Post>("posts", {
        limit: 2,
        order: "oldest",
        ...(cursor ? { cursor } : {}),
      });
      seen.push(...page.records.map((r) => r.title ?? ""));
      cursor = page.next_cursor;
    } while (cursor);
    expect(seen).toEqual(["p0", "p1", "p2", "p3", "p4"]);

    expect((await listAllRecords<Post>("posts", undefined, { order: "oldest" })).map((r) => r.title)).toEqual([
      "p0",
      "p1",
      "p2",
      "p3",
      "p4",
    ]);
    expect((await listAllRecords<Post>("posts", { likes: 0 }, { order: "oldest" })).map((r) => r.title)).toEqual([
      "p0",
      "p2",
      "p4",
    ]);
    expect((await listAllRecords<Post>("posts", { likes: 0 })).map((r) => r.title)).toEqual(["p4", "p2", "p0"]);
  });

  it("reads newest first when order is omitted, null or \"newest\"", async () => {
    for (let i = 0; i < 3; i += 1) {
      await createRecord("posts", { title: `p${i}` });
    }
    for (const order of [undefined, null, "newest"]) {
      const page = await call<{ records: Post[]; next_cursor: string | null }>({
        service: "simple-db",
        path: "/apps/mock-app/tables/posts/records/list",
        body: { limit: 2, ...(order !== undefined ? { order } : {}) },
      });
      expect(page.records.map((r) => r.title)).toEqual(["p2", "p1"]);
      expect(page.next_cursor).toEqual(expect.stringMatching(/^m2\./));
    }
  });

  it("refuses any other order with the service's 400", async () => {
    for (const order of ["sideways", "Oldest", 1, {}]) {
      await expect(
        call({ service: "simple-db", path: "/apps/mock-app/tables/posts/records/list", body: { order } }),
      ).rejects.toMatchObject({ status: 400, code: "bad_request" });
    }
  });

  it("refuses a cursor sent with the other order, and a malformed cursor, with the service's 400", async () => {
    for (let i = 0; i < 3; i += 1) {
      await createRecord("posts", { title: `p${i}` });
    }
    const newest = (await listRecords("posts", { limit: 1 })).next_cursor ?? "";
    const oldest = (await listRecords("posts", { limit: 1, order: "oldest" })).next_cursor ?? "";
    expect(newest).not.toBe("");
    expect(oldest).not.toBe("");
    for (const run of [
      () => listRecords("posts", { cursor: newest, order: "oldest" }),
      () => listRecords("posts", { cursor: oldest }),
      () => listRecords("posts", { cursor: oldest, order: "newest" }),
      () => listRecords("posts", { cursor: "nope" }),
      () => listRecords("posts", { cursor: "m2.nope", order: "oldest" }),
    ]) {
      await expect(run()).rejects.toMatchObject({ status: 400, code: "bad_request" });
    }
    await expect(listRecords("posts", { cursor: newest, order: "newest" })).resolves.toMatchObject({
      records: expect.any(Array),
    });
    await expect(listRecords("posts", { cursor: oldest, order: "oldest" })).resolves.toMatchObject({
      records: expect.any(Array),
    });
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

interface Slot extends DbRecord {
  slot_holder: string | null;
  total: number | null;
  score: number | null;
  label: string | null;
}

/** Every refusal of `run`, as the `PilelyError` the wrapper threw. */
async function refusal(run: () => Promise<unknown>): Promise<PilelyError> {
  const error = await run().then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(PilelyError);
  return error as PilelyError;
}

describe("simple-db fake: versions, conditions, keys and counters", () => {
  it("starts a record at _version 1 with _key null and raises it by one on every update shape", async () => {
    const created = await createRecord<Slot>("slots", { label: "a", total: 0 });
    expect(created).toMatchObject({ _version: 1, _key: null });
    expect((await updateRecord<Slot>("slots", created.id, { label: "b" }))._version).toBe(2);
    const counted = await updateRecord<Slot>("slots", created.id, {}, { inc: { total: 5 } });
    expect(counted).toMatchObject({ _version: 3, total: 5, label: "b" });
    const both = await updateRecord<Slot>("slots", created.id, { label: "c" }, { inc: { total: -2 } });
    expect(both).toMatchObject({ _version: 4, total: 3, label: "c" });
    expect(await getRecord<Slot>("slots", created.id)).toEqual(both);
    expect((await listRecords<Slot>("slots")).records).toEqual([both]);
  });

  it("answers a stale if_version on update and delete with 409 version_conflict and current_version, changing nothing", async () => {
    const created = await createRecord<Slot>("slots", { label: "a" });
    await updateRecord("slots", created.id, { label: "b" });

    const stale = await refusal(() => updateRecord("slots", created.id, { label: "x" }, { ifVersion: 1 }));
    expect(stale).toMatchObject({ status: 409, code: "version_conflict", currentVersion: 2, id: undefined });
    expect(stale.reason).toMatch(/version 2/);
    expect(await getRecord<Slot>("slots", created.id)).toMatchObject({ label: "b", _version: 2 });

    const raw = await call({
      service: "simple-db",
      path: `/apps/mock-app/tables/slots/records/${created.id}/delete`,
      body: { if_version: 7 },
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(raw).toMatchObject({ status: 409, code: "version_conflict", currentVersion: 2 });
    expect(await getRecord<Slot>("slots", created.id)).toMatchObject({ _version: 2 });

    expect(await updateRecord<Slot>("slots", created.id, { label: "c" }, { ifVersion: 2 })).toMatchObject({
      label: "c",
      _version: 3,
    });
    expect(await deleteRecord("slots", created.id, { ifVersion: 3 })).toBe(created.id);
    await expect(getRecord("slots", created.id)).rejects.toMatchObject({ status: 404 });
  });

  it("answers if_version on a missing row with the bare 404, never 409", async () => {
    const created = await createRecord<Slot>("slots", { label: "a" });
    await deleteRecord("slots", created.id);
    await expect(updateRecord("slots", created.id, { label: "x" }, { ifVersion: 1 })).rejects.toMatchObject({
      status: 404,
      code: null,
    });
    await expect(deleteRecord("slots", created.id, { ifVersion: 1 })).rejects.toMatchObject({ status: 404, code: null });
  });

  it("claims an empty slot once with if: {col: null}; a second claim is 409 condition_failed and the row keeps the first", async () => {
    const slot = await createRecord<Slot>("slots", { label: "s" });
    expect(slot.slot_holder).toBeUndefined();
    const claimed = await updateRecord<Slot>("slots", slot.id, { slot_holder: "a" }, { if: { slot_holder: null } });
    expect(claimed).toMatchObject({ slot_holder: "a", _version: 2 });

    const second = await refusal(() =>
      updateRecord("slots", slot.id, { slot_holder: "b" }, { if: { slot_holder: null } }),
    );
    expect(second).toMatchObject({ status: 409, code: "condition_failed", id: undefined, currentVersion: undefined });
    expect(await getRecord<Slot>("slots", slot.id)).toMatchObject({ slot_holder: "a", _version: 2 });

    // Both conditions failing answers version_conflict.
    const both = await refusal(() =>
      updateRecord("slots", slot.id, { slot_holder: "b" }, { ifVersion: 1, if: { slot_holder: null } }),
    );
    expect(both).toMatchObject({ code: "version_conflict", currentVersion: 2 });

    // `if` holds on a value equal the way `eq` compares, json included.
    await updateRecord("slots", slot.id, { label: "t" }, { if: { slot_holder: "a", label: "s" } });
    expect(await getRecord<Slot>("slots", slot.id)).toMatchObject({ label: "t", _version: 3 });
  });

  it("creates a keyed row once: a second create with the key is 409 key_exists naming the row; a delete frees it", async () => {
    const first = await createRecord<Slot>("events", { label: "one" }, { key: "evt_1" });
    expect(first._key).toBe("evt_1");
    const again = await refusal(() => createRecord("events", { label: "two" }, { key: "evt_1" }));
    expect(again).toMatchObject({ status: 409, code: "key_exists", id: first.id, currentVersion: undefined });
    expect(again.reason).toContain(first.id);
    expect((await listAllRecords<Slot>("events")).map((r) => r.id)).toEqual([first.id]);

    const unkeyed = await createRecord<Slot>("events", { label: "plain" });
    expect(unkeyed._key).toBeNull();

    await deleteRecord("events", first.id);
    const recreated = await createRecord<Slot>("events", { label: "three" }, { key: "evt_1" });
    expect(recreated).toMatchObject({ _key: "evt_1", _version: 1 });
    expect(recreated.id).not.toBe(first.id);
  });

  it("refuses a key outside 1–200 characters of A-Z a-z 0-9 _ - . : @ / + with the service's 400", async () => {
    for (const key of ["", "a".repeat(201), "has space", "ü", 7]) {
      await expect(
        call({ service: "simple-db", path: "/apps/mock-app/tables/events/records/create", body: { fields: {}, key } }),
      ).rejects.toMatchObject({ status: 400, code: "bad_request" });
    }
    const longest = await createRecord<Slot>("events", {}, { key: `Az09_-.:@/+${"k".repeat(189)}` });
    expect(longest._key).toHaveLength(200);
    expect(await listAllRecords("events")).toHaveLength(1);
  });

  it("adds with inc from the value a read returns, null starting from 0, and refuses the inc 400s changing nothing", async () => {
    const row = await createRecord<Slot>("counters", { label: "c", total: 1, score: 1.5 });
    expect(await updateRecord<Slot>("counters", row.id, {}, { inc: { total: 2, score: 0.25 } })).toMatchObject({
      total: 3,
      score: 1.75,
      _version: 2,
    });
    await updateRecord("counters", row.id, { total: null });
    expect(await updateRecord<Slot>("counters", row.id, {}, { inc: { total: 4 } })).toMatchObject({
      total: 4,
      _version: 4,
    });
    expect(await updateRecord<Slot>("counters", row.id, {}, { inc: { total: 0 } })).toMatchObject({
      total: 4,
      _version: 5,
    });

    for (const run of [
      () => updateRecord("counters", row.id, {}, { inc: { label: 1 } }),
      () => updateRecord("counters", row.id, { total: 1 }, { inc: { total: 1 } }),
      () => updateRecord("counters", row.id, {}, { inc: { total: 0.5 } }),
      () => updateRecord("counters", row.id, {}, { inc: { total: 2 ** 63 } }),
      () => updateRecord("counters", row.id, {}, { inc: { score: Number.MAX_VALUE } }).then(() =>
        updateRecord("counters", row.id, {}, { inc: { score: Number.MAX_VALUE } }),
      ),
      () => updateRecord("counters", row.id, {}),
      () => updateRecord("counters", row.id, {}, { inc: {} }),
    ]) {
      await expect(run()).rejects.toMatchObject({ status: 400, code: "bad_request" });
    }
    const after = await getRecord<Slot>("counters", row.id);
    expect(after).toMatchObject({ total: 4, label: "c" });
  });

  it("refuses more than 64 inc or if columns, and a reserved field in fields, inc or if", async () => {
    const row = await createRecord<Slot>("counters", { total: 0 });
    const many = Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`c${i}`, 1]));
    for (const run of [
      () => updateRecord("counters", row.id, {}, { inc: many }),
      () => updateRecord("counters", row.id, { total: 1 }, { if: many }),
      () => updateRecord("counters", row.id, { _version: 9 }),
      () => updateRecord("counters", row.id, {}, { inc: { _version: 1 } }),
      () => updateRecord("counters", row.id, { total: 1 }, { if: { _key: null } }),
      () => createRecord("counters", { _key: "k" }),
    ]) {
      await expect(run()).rejects.toMatchObject({ status: 400, code: "bad_request" });
    }
    expect(await getRecord<Slot>("counters", row.id)).toMatchObject({ total: 0, _version: 1 });
  });

  it("refuses an unknown body field on every record route — a misspelled ifVersion never updates", async () => {
    const row = await createRecord<Slot>("slots", { label: "a" });
    const base = `/apps/mock-app/tables/slots/records`;
    for (const [path, body] of [
      [`${base}/${row.id}/update`, { fields: { label: "x" }, ifVersion: 1 }],
      [`${base}/create`, { fields: { label: "x" }, keys: "k" }],
      [`${base}/${row.id}/get`, { consistant: true }],
      [`${base}/${row.id}/delete`, { force: true }],
      [`${base}/${row.id}/update`, { fields: { label: "x" }, if_version: 0 }],
      [`${base}/${row.id}/update`, { fields: { label: "x" }, if_version: 1.5 }],
      [`${base}/${row.id}/delete`, { if_version: "1" }],
      [`${base}/${row.id}/get`, { consistent: "yes" }],
    ] as const) {
      await expect(call({ service: "simple-db", path, body })).rejects.toMatchObject({
        status: 400,
        code: "bad_request",
      });
    }
    expect(await getRecord<Slot>("slots", row.id)).toMatchObject({ label: "a", _version: 1 });
    expect(await listAllRecords("slots")).toHaveLength(1);
  });

  it("answers a consistent get with the values the last update left", async () => {
    const row = await createRecord<Slot>("slots", { label: "a" });
    await updateRecord("slots", row.id, { label: "b" });
    expect(await getRecord<Slot>("slots", row.id, { consistent: true })).toMatchObject({ label: "b", _version: 2 });
    expect(await getRecord<Slot>("slots", row.id, { consistent: false })).toMatchObject({ label: "b" });
  });
});

const DEFAULT_ROW_ACCESS = {
  read_scope: "all",
  audience_column: null,
  mutate_scope: "owner",
  mutate_group: null,
  deny_group: null,
} as const;

const ROW_ACCESS = {
  read_scope: "own",
  audience_column: "to_user_id",
  mutate_scope: "own",
  mutate_group: "staff1",
  deny_group: "bans1",
} as const;

describe("simple-db fake: row-level settings", () => {
  const messages = {
    table: "messages",
    columns: [
      { name: "body", type: "text" as const },
      { name: "to_user_id", type: "text" as const },
    ],
    read_group: null,
    write_group: null,
  };

  it("tables/create stores the five settings, and every table route answers with them", async () => {
    const created = await createTable({ ...messages, ...ROW_ACCESS });
    expect(created).toMatchObject({ name: "messages", anon_read: false, ...ROW_ACCESS });
    expect((await listTables()).tables).toEqual([created]);
    const withColumn = await addColumn("messages", { name: "read", type: "boolean" });
    expect(withColumn).toMatchObject(ROW_ACCESS);
  });

  it("tables/create defaults every omitted setting, and reads null as the default", async () => {
    const plain = await createTable({ ...messages, table: "plain" });
    expect(plain).toMatchObject(DEFAULT_ROW_ACCESS);
    const nulls = await createTable({
      ...messages,
      table: "nulls",
      read_scope: null,
      audience_column: null,
      mutate_scope: null,
      mutate_group: null,
      deny_group: null,
    });
    expect(nulls).toMatchObject(DEFAULT_ROW_ACCESS);
  });

  it("access/set keeps every row-level key it omits and changes only the ones it names", async () => {
    await createTable({ ...messages, ...ROW_ACCESS });
    expect(await setTableAccess("messages", { read_group: null, write_group: "writers1" })).toEqual({
      table: "messages",
      read_group: null,
      write_group: "writers1",
      anon_read: false,
      ...ROW_ACCESS,
    });
    expect(await setTableAccess("messages", { read_group: null, write_group: null, deny_group: null })).toEqual({
      table: "messages",
      read_group: null,
      write_group: null,
      anon_read: false,
      ...ROW_ACCESS,
      deny_group: null,
    });
    // Sending back what tables/list answered works, the audience column included.
    const [listed] = (await listTables()).tables;
    if (!listed) throw new Error("tables/list lost the table");
    const { read_group, write_group, anon_read, read_scope, audience_column, mutate_scope, mutate_group, deny_group } =
      listed;
    expect(
      await setTableAccess("messages", {
        read_group,
        write_group,
        anon_read,
        read_scope,
        audience_column,
        mutate_scope,
        mutate_group,
        deny_group,
      }),
    ).toMatchObject({ ...ROW_ACCESS, deny_group: null });
  });

  it("refuses the service's row-level 400s and changes nothing", async () => {
    await createTable({ ...messages, read_scope: "own", audience_column: "to_user_id" });
    for (const run of [
      () => createTable({ ...messages, table: "t1", read_scope: "mine" as never }),
      () => createTable({ ...messages, table: "t2", mutate_scope: "anyone" as never }),
      () => createTable({ ...messages, table: "t3", read_scope: "own", anon_read: true }),
      () => createTable({ ...messages, table: "t4", audience_column: "missing" }),
      () => createTable({ ...messages, table: "t5", columns: [{ name: "to_user_id", type: "integer" }], audience_column: "to_user_id" }),
      () => createTable({ ...messages, table: "t6", mutate_group: "" }),
      () => createTable({ ...messages, table: "t7", deny_group: "not a nanoid" }),
      // anon_read: true on a table whose stored read_scope is "own".
      () => setTableAccess("messages", { read_group: null, write_group: null, anon_read: true }),
      () => setTableAccess("messages", { read_group: null, write_group: null, audience_column: "body" }),
      () => setTableAccess("messages", { read_group: null, write_group: null, audience_column: null }),
      () => setTableAccess("messages", { read_group: null, write_group: null, deny_group: "" }),
    ]) {
      await expect(run()).rejects.toMatchObject({ status: 400, code: "bad_request" });
    }
    expect((await listTables()).tables.map((t) => t.name)).toEqual(["messages"]);
    expect((await listTables()).tables[0]).toMatchObject({
      anon_read: false,
      read_scope: "own",
      audience_column: "to_user_id",
      deny_group: null,
    });
    // Opening the table to anon_read works once read_scope goes back to "all".
    expect(
      await setTableAccess("messages", { read_group: null, write_group: null, anon_read: true, read_scope: "all" }),
    ).toMatchObject({ anon_read: true, read_scope: "all", audience_column: "to_user_id" });
  });

  it("reads a persisted table stored without the settings as the defaults", async () => {
    const ctx = {
      appId: "mock-app",
      user: () => ({ id: "u-a", handle: "a", app: "mock-app" }),
      load: <T>() =>
        ({
          apps: {
            "mock-app": {
              app_id: "mock-app",
              owner_handle: "a",
              created_time_stamp: 1,
              implicit: false,
              tables: {
                legacy: { name: "legacy", read_group: null, write_group: null, anon_read: false, created_at_ms: 1, columns: [], implicit: false, records: [] },
              },
            },
          },
        }) as T,
      save: () => undefined,
      now: () => 2,
      uuid: () => "00000000-0000-4000-8000-000000000001",
      nanoid: () => "n",
      ok: (body: unknown, status = 200) => ({ status, body }),
      notFound: () => ({ status: 404 }),
      refuse: (status: number, code: string, reason: string) => ({ status, body: { ok: false, code, reason } }),
    } as MockServiceContext;
    const fake = createSimpleDbFake(ctx);
    const listed = (await fake.handle({ path: "/apps/mock-app/tables/list", body: {}, form: null })) as MockReply;
    expect((listed.body as { tables: unknown[] }).tables[0]).toMatchObject(DEFAULT_ROW_ACCESS);
    const kept = (await fake.handle({
      path: "/apps/mock-app/tables/legacy/access/set",
      body: { read_group: null, write_group: null },
      form: null,
    })) as MockReply;
    expect(kept.body).toEqual({
      ok: true,
      table: "legacy",
      read_group: null,
      write_group: null,
      anon_read: false,
      ...DEFAULT_ROW_ACCESS,
    });
  });
});

describe("simple-db fake: new_row_email", () => {
  const inbox = { table: "inbox", columns: [{ name: "body", type: "text" as const }], read_group: null, write_group: null };
  const notifySet = "/apps/mock-app/tables/inbox/notify/set";

  it("every table answer reads \"off\" until notify/set changes it", async () => {
    expect(await createTable(inbox)).toMatchObject({ name: "inbox", new_row_email: "off" });
    expect((await listTables()).tables[0]).toMatchObject({ new_row_email: "off" });
    expect(await addColumn("inbox", { name: "read", type: "boolean" })).toMatchObject({ new_row_email: "off" });
    // A table made by first use reads "off" too.
    await createRecord("implicit", { title: "x" });
    expect((await listTables()).tables.find((t) => t.name === "implicit")).toMatchObject({ new_row_email: "off" });
  });

  it("notify/set stores and echoes each value, and tables/list reads it back", async () => {
    await createTable(inbox);
    for (const value of ["each", "daily", "off", "off"] as const) {
      expect(await setNewRowEmail("inbox", value)).toEqual({ table: "inbox", new_row_email: value });
      expect((await listTables()).tables[0]).toMatchObject({ name: "inbox", new_row_email: value });
    }
    await setNewRowEmail("inbox", "daily");
    expect(await addColumn("inbox", { name: "seen", type: "boolean" })).toMatchObject({ new_row_email: "daily" });
    // access/set leaves it alone and does not answer it.
    const access = await setTableAccess("inbox", { read_group: null, write_group: null });
    expect(access).not.toHaveProperty("new_row_email");
    expect((await listTables()).tables[0]).toMatchObject({ new_row_email: "daily" });
  });

  it("refuses the service's bad_request shapes and changes nothing", async () => {
    await createTable(inbox);
    await setNewRowEmail("inbox", "each");
    for (const body of [{}, { new_row_email: null }, { new_row_email: "weekly" }, { new_row_email: 1 }, { new_row_email: "EACH" }]) {
      await expect(call({ service: "simple-db", path: notifySet, body })).rejects.toMatchObject({
        status: 400,
        code: "bad_request",
      });
    }
    expect((await listTables()).tables[0]).toMatchObject({ new_row_email: "each" });
  });

  it("answers the bare 404 signed out, and never refuses with email_not_ready (no email service)", async () => {
    await createTable(inbox);
    pilely().signOut();
    await expect(setNewRowEmail("inbox", "each")).rejects.toMatchObject({ status: 404, code: null });
    await pilely().signIn();
    expect((await listTables()).tables[0]).toMatchObject({ new_row_email: "off" });
    expect(await setNewRowEmail("inbox", "each")).toEqual({ table: "inbox", new_row_email: "each" });
  });

  it("reads a persisted table stored without the setting as \"off\"", async () => {
    const ctx = {
      appId: "mock-app",
      user: () => ({ id: "u-a", handle: "a", app: "mock-app" }),
      load: <T>() =>
        ({
          apps: {
            "mock-app": {
              app_id: "mock-app",
              owner_handle: "a",
              created_time_stamp: 1,
              implicit: false,
              tables: {
                legacy: { name: "legacy", read_group: null, write_group: null, anon_read: false, created_at_ms: 1, columns: [], implicit: false, records: [] },
              },
            },
          },
        }) as T,
      save: () => undefined,
      now: () => 2,
      uuid: () => "00000000-0000-4000-8000-000000000001",
      nanoid: () => "n",
      ok: (body: unknown, status = 200) => ({ status, body }),
      notFound: () => ({ status: 404 }),
      refuse: (status: number, code: string, reason: string) => ({ status, body: { ok: false, code, reason } }),
    } as MockServiceContext;
    const fake = createSimpleDbFake(ctx);
    const listed = (await fake.handle({ path: "/apps/mock-app/tables/list", body: {}, form: null })) as MockReply;
    expect((listed.body as { tables: unknown[] }).tables[0]).toMatchObject({ new_row_email: "off" });
    const set = (await fake.handle({
      path: "/apps/mock-app/tables/legacy/notify/set",
      body: { new_row_email: "daily" },
      form: null,
    })) as MockReply;
    expect(set.body).toEqual({ ok: true, table: "legacy", new_row_email: "daily" });
  });
});

describe("simple-db fake: eq on _submitter_user_id, no row scoping", () => {
  function fakeWith(users: { current: PilelyUser | null }) {
    let slice: unknown;
    let clock = 1_000;
    let ids = 0;
    const ctx: MockServiceContext = {
      appId: "mock-app",
      user: () => users.current,
      load: <T>() => slice as T | undefined,
      save: (next) => {
        slice = next;
      },
      now: () => (clock += 1),
      uuid: () => `00000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`,
      nanoid: () => "n",
      ok: (body, status = 200) => ({ status, body }),
      notFound: () => ({ status: 404 }),
      refuse: (status, code, reason) => ({ status, body: { ok: false, code, reason } }),
    };
    const fake = createSimpleDbFake(ctx);
    return async (path: string, body: unknown): Promise<MockReply> =>
      (await fake.handle({ path: `/apps/mock-app${path}`, body, form: null })) as MockReply;
  }

  const A: PilelyUser = { id: "u-a", handle: "a", app: "mock-app" };
  const B: PilelyUser = { id: "u-b", handle: "b", app: "mock-app" };

  it("filters by submitter, refuses the filter signed out, and leaves an \"own\" table unscoped", async () => {
    const users: { current: PilelyUser | null } = { current: A };
    const send = fakeWith(users);
    expect(
      (await send("/tables/create", { table: "notes", columns: [{ name: "body", type: "text" }], read_group: null, write_group: null, read_scope: "own" })).status,
    ).toBe(200);
    await send("/tables/notes/records/create", { fields: { body: "a1" } });
    users.current = B;
    await send("/tables/notes/records/create", { fields: { body: "b1" } });
    await send("/tables/notes/records/create", { fields: { body: "b2" } });

    const bodies = (reply: MockReply) => (reply.body as { records: { body: string }[] }).records.map((r) => r.body);
    expect(bodies(await send("/tables/notes/records/list", { eq: { _submitter_user_id: "u-a" } }))).toEqual(["a1"]);
    expect(bodies(await send("/tables/notes/records/list", { eq: { _submitter_user_id: "u-b" }, order: "oldest" }))).toEqual([
      "b1",
      "b2",
    ]);
    // The fake stores read_scope but does not apply it: B still lists A's row.
    expect(bodies(await send("/tables/notes/records/list", {}))).toEqual(["b2", "b1", "a1"]);

    users.current = null;
    expect(await send("/tables/notes/records/list", { eq: { _submitter_user_id: "u-a" } })).toMatchObject({
      status: 400,
      body: { code: "bad_request" },
    });
    expect((await send("/tables/notes/records/list", {})).status).toBe(200);
  });
});

describe("simple-db fake: a key is unique per submitter", () => {
  /** A fake behind a context whose signed-in user the test switches. */
  function fakeWith(users: { current: PilelyUser | null }) {
    let slice: unknown;
    let clock = 1_000;
    let ids = 0;
    const ctx: MockServiceContext = {
      appId: "mock-app",
      user: () => users.current,
      load: <T>() => slice as T | undefined,
      save: (next) => {
        slice = next;
      },
      now: () => (clock += 1),
      uuid: () => `00000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`,
      nanoid: () => "n",
      ok: (body, status = 200) => ({ status, body }),
      notFound: () => ({ status: 404 }),
      refuse: (status, code, reason) => ({ status, body: { ok: false, code, reason } }),
    };
    const fake = createSimpleDbFake(ctx);
    return async (fields: Record<string, unknown>, key: string): Promise<MockReply> =>
      (await fake.handle({
        path: "/apps/mock-app/tables/votes/records/create",
        body: { fields, key },
        form: null,
      })) as MockReply;
  }

  it("lets two submitters each create with one key, and names only the submitter's own row on a 409", async () => {
    const users: { current: PilelyUser | null } = { current: { id: "u-a", handle: "a", app: "mock-app" } };
    const create = fakeWith(users);
    const mine = await create({ choice: 1 }, "k1");
    expect(mine.status).toBe(200);
    const mineId = (mine.body as { record: { id: string } }).record.id;

    users.current = { id: "u-b", handle: "b", app: "mock-app" };
    const theirs = await create({ choice: 2 }, "k1");
    expect(theirs.status).toBe(200);
    expect((theirs.body as { record: { _key: string } }).record._key).toBe("k1");
    const theirsId = (theirs.body as { record: { id: string } }).record.id;
    expect(theirsId).not.toBe(mineId);
    expect(await create({ choice: 3 }, "k1")).toEqual({
      status: 409,
      body: { ok: false, code: "key_exists", reason: expect.stringContaining(theirsId), id: theirsId },
    });

    users.current = { id: "u-a", handle: "a", app: "mock-app" };
    expect(await create({ choice: 4 }, "k1")).toMatchObject({ status: 409, body: { id: mineId } });
  });
});

describe("simple-db fake: provisioning", () => {
  it("creates tables on first use and answers the table routes in the real shapes", async () => {
    expect(await listTables()).toEqual({ tables: [], nextCursor: null });
    await createRecord("notes", { body: "x", done: false, rank: 1.5, meta: { a: 1 } });
    const [notes] = (await listTables()).tables;
    expect(notes).toEqual({
      name: "notes",
      read_group: null,
      write_group: null,
      anon_read: false,
      ...DEFAULT_ROW_ACCESS,
      new_row_email: "off",
      sorts: [{ by: "_created_at_ms", state: "ready" }],
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
      ...DEFAULT_ROW_ACCESS,
    });
  });

  it("answers the app routes in the real shapes", async () => {
    const app = await createApp();
    expect(app).toEqual({ app_id: "mock-app", owner_handle: "mock_user", created_time_stamp: expect.any(Number) });
    await expect(createApp()).rejects.toMatchObject({ status: 409, code: "db_already_exists" });
    expect(await listApps()).toEqual({ apps: [app], nextCursor: null });
    expect(await deleteApp()).toBe("mock-app");
    expect(await listApps()).toEqual({ apps: [], nextCursor: null });
    await expect(deleteApp()).rejects.toMatchObject({ status: 404, code: null });
  });

  it("pages tables oldest first, past any number of tables, each exactly once", async () => {
    for (let i = 0; i < 25; i += 1) {
      await createTable({ table: `t${i}`, columns: [], read_group: null, write_group: null });
    }
    const first = await listTables({ limit: 10 });
    expect(first.tables.map((t) => t.name)).toEqual(Array.from({ length: 10 }, (_, i) => `t${i}`));
    expect(first.nextCursor).toEqual(expect.stringMatching(/^\d+:t9$/));

    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await listTables({ limit: 10, ...(cursor ? { cursor } : {}) });
      seen.push(...page.tables.map((t) => t.name));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(Array.from({ length: 25 }, (_, i) => `t${i}`));

    expect((await listTables({ limit: 25 })).nextCursor).toBeNull();
  });

  it("lists only the calling app's own database, never another app's", async () => {
    for (const id of ["a1", "a2"]) {
      await call({ service: "simple-db", path: `/apps/${id}/create` });
    }
    expect(await listApps({ limit: 1 })).toEqual({ apps: [], nextCursor: null });
    await call({ service: "simple-db", path: `/apps/${appId()}/create` });
    const page = await listApps({ limit: 1 });
    expect(page.apps.map((a) => a.app_id)).toEqual([appId()]);
    expect(page.nextCursor).toBeNull();
  });

  it("refuses an out-of-range limit or a malformed cursor on both list routes with the service's 400", async () => {
    for (const run of [
      () => listTables({ limit: 0 }),
      () => listTables({ limit: 101 }),
      () => listTables({ cursor: "nope" }),
      () => listApps({ limit: 101 }),
      () => listApps({ cursor: "nope" }),
    ]) {
      await expect(run()).rejects.toMatchObject({ status: 400, code: "bad_request" });
    }
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

interface Comment extends DbRecord {
  body: string | null;
  image: DbFile | null;
}

const FILE_ID = /^[A-Za-z0-9]{22}$/;

describe("simple-db fake: file columns through the real wrapper", () => {
  it("a Blob in createRecord uploads and attaches in one call; the column is typed file on first use", async () => {
    const created = await createRecord<Comment>("comments", {
      body: "hi",
      image: new Blob(["abc"], { type: "image/png" }),
    });
    expect(created.image).toEqual({ file_id: expect.stringMatching(FILE_ID), content_type: "image/png", size_bytes: 3 });
    const { tables } = await listTables();
    expect(tables.find((t) => t.name === "comments")?.columns).toEqual([
      { name: "image", type: "file" },
      { name: "body", type: "text" },
    ]);
    // Without file_urls a read carries no link.
    expect((await getRecord<Comment>("comments", created.id)).image).toEqual(created.image);
  });

  it("file_urls and downloadFile answer a link to the bytes; a list with file_urls links every file", async () => {
    const created = await createRecord<Comment>("comments", { image: new Blob(["abcd"], { type: "text/plain" }) });
    const read = await getRecord<Comment>("comments", created.id, { fileUrls: true });
    expect(read.image).toEqual({ ...created.image, url: expect.any(String) });
    const link = await downloadFile("comments", created.id, "image");
    expect(link).toEqual({ url: read.image?.url, content_type: "text/plain", size_bytes: 4 });
    const page = await listRecords<Comment>("comments", { file_urls: true });
    expect(page.records[0]?.image?.url).toBe(link.url);
    expect((await listRecords<Comment>("comments")).records[0]?.image).not.toHaveProperty("url");
  });

  it("updateRecord with a new Blob replaces the file; null clears it and its link is then the uniform 404", async () => {
    const created = await createRecord<Comment>("comments", { image: new Blob(["a"], { type: "image/png" }) });
    const replaced = await updateRecord<Comment>("comments", created.id, {
      image: new Blob(["bb"], { type: "image/jpeg" }),
    });
    expect(replaced.image).toEqual({ file_id: expect.stringMatching(FILE_ID), content_type: "image/jpeg", size_bytes: 2 });
    expect(replaced.image?.file_id).not.toBe(created.image?.file_id);
    expect(replaced._version).toBe(2);

    const cleared = await updateRecord<Comment>("comments", created.id, { image: null });
    expect(cleared.image).toBeNull();
    await expect(downloadFile("comments", created.id, "image")).rejects.toMatchObject({ status: 404, code: null });
  });

  it("a deleted record's file is gone with it", async () => {
    const created = await createRecord<Comment>("comments", { image: new Blob(["a"], { type: "image/png" }) });
    await deleteRecord("comments", created.id);
    await expect(downloadFile("comments", created.id, "image")).rejects.toMatchObject({ status: 404 });
  });

  it("refuses upload/start signed out with the bare 404, and on a column that is not a file column with 400", async () => {
    await createRecord("comments", { body: "text" });
    await expect(
      call({ service: "simple-db", path: "/apps/mock-app/tables/comments/files/body/upload/start", body: { content_type: "image/png" } }),
    ).rejects.toMatchObject({ status: 400, code: "bad_request" });
    for (const body of [{}, { content_type: "" }, { content_type: " image/png" }, { content_type: "image/png", size: 3 }]) {
      await expect(
        call({ service: "simple-db", path: "/apps/mock-app/tables/comments/files/image/upload/start", body }),
      ).rejects.toMatchObject({ status: 400, code: "bad_request" });
    }
    pilely().signOut();
    await expect(createRecord("comments", { image: new Blob(["a"], { type: "image/png" }) })).rejects.toMatchObject({
      status: 404,
      code: null,
    });
  });

  it("a ticket attaches once, only for its own column, never with nothing uploaded; any other value is 400", async () => {
    const start = (column: string) =>
      call<DbUploadTicket>({
        service: "simple-db",
        path: `/apps/mock-app/tables/comments/files/${column}/upload/start`,
        body: { content_type: "image/png" },
      });
    const put = (uploadId: string, contentType = "image/png") => {
      const form = new FormData();
      form.append("file", new Blob(["xyz"]));
      form.append("content_type", contentType);
      return call({ service: "simple-db", path: `${MOCK_UPLOAD_PATH}${uploadId}`, form });
    };
    const create = (fields: Record<string, unknown>) =>
      call<{ record: Comment }>({ service: "simple-db", path: "/apps/mock-app/tables/comments/records/create", body: { fields } });

    const empty = await start("image");
    expect(empty.upload_url).toMatch(/^https:\/\//);
    expect(empty.expires_at).toBeGreaterThan(Date.now());
    await expect(create({ image: { upload: empty.upload_id } })).rejects.toMatchObject({ status: 400 });

    await expect(put(empty.upload_id, "image/gif")).rejects.toMatchObject({ status: 403, code: "upload_failed" });
    await put(empty.upload_id);
    await start("thumb");
    await expect(create({ thumb: { upload: empty.upload_id } })).rejects.toMatchObject({ status: 400 });
    const { record } = await create({ image: { upload: empty.upload_id } });
    expect(record.image).toMatchObject({ content_type: "image/png", size_bytes: 3 });
    await expect(create({ image: { upload: empty.upload_id } })).rejects.toMatchObject({ status: 400 });

    for (const value of [record.image, { file_id: record.image?.file_id }, "x", 1, { upload: "nope" }]) {
      await expect(create({ image: value })).rejects.toMatchObject({ status: 400, code: "bad_request" });
    }
    await expect(listRecords("comments", { eq: { image: null } })).rejects.toMatchObject({ status: 400 });
    await expect(updateRecord("comments", record.id, { body: "b" }, { if: { image: null } })).rejects.toMatchObject({
      status: 400,
    });
    await expect(updateRecord("comments", record.id, {}, { inc: { image: 1 } })).rejects.toMatchObject({ status: 400 });
    await expect(addColumn("comments", { name: "cover", type: "file", default: {} })).rejects.toMatchObject({ status: 400 });
  });
});

describe("simple-db fake: a ticket belongs to its caller and expires", () => {
  function fakeWith(users: { current: PilelyUser | null }, clock: { now: number }) {
    let ids = 0;
    const ctx: MockServiceContext = {
      appId: "mock-app",
      user: () => users.current,
      load: () => undefined,
      save: () => undefined,
      now: () => (clock.now += 1),
      uuid: () => `00000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`,
      nanoid: (length = 21) => String((ids += 1)).padStart(length, "a"),
      ok: (body, status = 200) => ({ status, body }),
      notFound: () => ({ status: 404 }),
      refuse: (status, code, reason) => ({ status, body: { ok: false, code, reason } }),
    };
    const fake = createSimpleDbFake(ctx);
    const send = async (path: string, body: unknown, form: FormData | null = null): Promise<MockReply> =>
      (await fake.handle({ path, body, form })) as MockReply;
    return {
      start: async () =>
        (await send("/apps/mock-app/tables/comments/files/image/upload/start", { content_type: "image/png" }))
          .body as DbUploadTicket,
      put: (uploadId: string) => {
        const form = new FormData();
        form.append("file", new Blob(["x"]));
        form.append("content_type", "image/png");
        return send(`${MOCK_UPLOAD_PATH}${uploadId}`, undefined, form);
      },
      attach: (uploadId: string) =>
        send("/apps/mock-app/tables/comments/records/create", { fields: { image: { upload: uploadId } } }),
    };
  }

  const alice = { id: "alice", handle: "alice" } as PilelyUser;
  const bob = { id: "bob", handle: "bob" } as PilelyUser;

  it("another caller's ticket is 400; its own caller attaches it", async () => {
    const users = { current: alice as PilelyUser | null };
    const fake = fakeWith(users, { now: 1_000 });
    const ticket = await fake.start();
    expect((await fake.put(ticket.upload_id)).status).toBe(200);
    users.current = bob;
    expect((await fake.attach(ticket.upload_id)).status).toBe(400);
    users.current = alice;
    expect((await fake.attach(ticket.upload_id)).status).toBe(200);
  });

  it("a PUT after the link's 5 minutes is refused; an upload put in time attaches until an hour after, then is 400", async () => {
    const clock = { now: 1_000 };
    const fake = fakeWith({ current: alice }, clock);
    const late = await fake.start();
    clock.now += 5 * 60 * 1000;
    expect((await fake.put(late.upload_id)).status).toBe(403);

    const slow = await fake.start();
    expect((await fake.put(slow.upload_id)).status).toBe(200);
    clock.now += 50 * 60 * 1000;
    const kept = await fake.start();
    expect((await fake.put(kept.upload_id)).status).toBe(200);
    expect((await fake.attach(slow.upload_id)).status).toBe(200);
    clock.now += 65 * 60 * 1000;
    expect((await fake.attach(kept.upload_id)).status).toBe(400);
  });
});

describe("simple-db fake: sorts, where and count answer like the service", () => {
  const A: PilelyUser = { id: "u-a", handle: "a", app: "mock-app" };
  const B: PilelyUser = { id: "u-b", handle: "b", app: "mock-app" };

  type Answer = Record<string, unknown> & {
    ok?: boolean;
    code?: string;
    reason?: string;
    records?: Record<string, unknown>[];
    next_cursor?: string | null;
    count?: number;
    table?: { sorts: unknown };
  };

  /** A fake behind a context whose signed-in user the test switches. */
  function fakeWith(users: { current: PilelyUser | null }) {
    let slice: unknown;
    let clock = 1_000;
    let ids = 0;
    const ctx: MockServiceContext = {
      appId: "mock-app",
      user: () => users.current,
      load: <T>() => slice as T | undefined,
      save: (next) => {
        slice = next;
      },
      now: () => (clock += 1),
      uuid: () => `00000000-0000-4000-8000-${String((ids += 1)).padStart(12, "0")}`,
      nanoid: () => "n",
      ok: (body, status = 200) => ({ status, body }),
      notFound: () => ({ status: 404 }),
      refuse: (status, code, reason) => ({ status, body: { ok: false, code, reason } }),
    };
    const fake = createSimpleDbFake(ctx);
    return async (path: string, body: unknown): Promise<{ status: number; body: Answer }> => {
      const reply = (await fake.handle({ path: `/apps/mock-app${path}`, body, form: null })) as MockReply;
      return { status: reply.status ?? 200, body: (reply.body ?? {}) as Answer };
    };
  }

  /** The columns of every table here, as the service's tests declare them
   *  (`rank` gains its default 5 through `columns/add`). */
  const COLUMNS = [
    { name: "title", type: "text" },
    { name: "score", type: "real" },
    { name: "done", type: "boolean" },
    { name: "info", type: "json" },
    { name: "to", type: "text" },
    { name: "photo", type: "file" },
  ];

  async function world(sorts?: unknown) {
    const users: { current: PilelyUser | null } = { current: A };
    const send = fakeWith(users);
    const created = await send("/tables/create", {
      table: "items",
      columns: COLUMNS,
      read_group: null,
      write_group: null,
      ...(sorts !== undefined ? { sorts } : {}),
    });
    expect(created.status).toBe(200);
    expect((await send("/tables/items/columns/add", { name: "rank", type: "integer", default: 5 })).status).toBe(200);
    const put = async (fields: Record<string, unknown>) => {
      const reply = await send("/tables/items/records/create", { fields });
      expect(reply.status).toBe(200);
      return reply.body.record as Record<string, unknown> & { id: string; _created_at_ms: number; _updated_at_ms: number };
    };
    const list = (body: Record<string, unknown>) => send("/tables/items/records/list", body);
    const walk = async (body: Record<string, unknown>) => {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const page = await list({ ...body, ...(cursor ? { cursor } : {}) });
        expect(page.status, JSON.stringify(page.body)).toBe(200);
        seen.push(...(page.body.records ?? []).map((r) => r.id as string));
        cursor = page.body.next_cursor ?? null;
      } while (cursor);
      return seen;
    };
    const count = async (body: Record<string, unknown>) => {
      let total = 0;
      let parts = 0;
      let cursor: string | null = null;
      do {
        const part = await list({ ...body, count: true, ...(cursor ? { cursor } : {}) });
        expect(part.status, JSON.stringify(part.body)).toBe(200);
        expect(part.body.records).toBeUndefined();
        total += part.body.count ?? 0;
        parts += 1;
        cursor = part.body.next_cursor ?? null;
      } while (cursor);
      return { total, parts };
    };
    return { users, send, created: created.body, put, list, walk, count };
  }

  const shown = (...list: [string, "ready" | "building"][]) => list.map(([by, state]) => ({ by, state }));

  it("tables/create takes sorts, every table answer shows them, and every disallowed list is a 400", async () => {
    const declared = await world(["title", "_created_at_ms"]);
    expect(declared.created.table?.sorts).toEqual(shown(["title", "ready"], ["_created_at_ms", "ready"]));
    const listed = await declared.send("/tables/list", {});
    expect((listed.body.tables as { sorts: unknown }[])[0]?.sorts).toEqual(
      shown(["title", "ready"], ["_created_at_ms", "ready"]),
    );

    expect((await world([])).created.table?.sorts).toEqual([]);
    expect((await world()).created.table?.sorts).toEqual(shown(["_created_at_ms", "ready"]));
    expect((await world(null)).created.table?.sorts).toEqual(shown(["_created_at_ms", "ready"]));

    const { send } = await world();
    for (const bad of [
      ["info"],
      ["photo"],
      ["nope"],
      ["_submitter_user_id"],
      ["title", "title"],
      ["title", "score", "done", "_created_at_ms"],
      "title",
      [1],
      {},
    ]) {
      const reply = await send("/tables/create", {
        table: "badsorts",
        columns: COLUMNS,
        read_group: null,
        write_group: null,
        sorts: bad,
      });
      expect(reply.status, JSON.stringify(bad)).toBe(400);
      expect(reply.body.code).toBe("bad_request");
    }
    expect((await send("/tables/list", {})).body.tables as unknown[]).toHaveLength(1);
  });

  it("sorts/set is ready on an empty table, building on one with rows until tables/list, and a removed sort stops at once", async () => {
    const w = await world();
    const empty = await w.send("/tables/items/sorts/set", { sorts: ["_created_at_ms", "rank"] });
    expect(empty.status).toBe(200);
    expect(empty.body.table?.sorts).toEqual(shown(["_created_at_ms", "ready"], ["rank", "ready"]));

    await w.put({ title: "a" });
    await w.put({ title: "b" });
    const page = await w.list({ limit: 1 });
    const cursor = page.body.next_cursor as string;

    const building = await w.send("/tables/items/sorts/set", { sorts: ["_created_at_ms", "title"] });
    expect(building.body.table?.sorts).toEqual(shown(["_created_at_ms", "ready"], ["title", "building"]));
    expect(await w.list({ sort: { by: "title", dir: "asc" } })).toMatchObject({
      status: 400,
      body: { code: "bad_request", reason: expect.stringContaining("still building") },
    });
    // The removed sort is refused at once; every earlier cursor too.
    expect((await w.list({ sort: { by: "rank", dir: "asc" } })).status).toBe(400);
    expect(await w.list({ cursor })).toMatchObject({
      status: 400,
      body: { reason: expect.stringContaining("sorts changed") },
    });

    const polled = await w.send("/tables/list", {});
    expect((polled.body.tables as { sorts: unknown }[])[0]?.sorts).toEqual(
      shown(["_created_at_ms", "ready"], ["title", "ready"]),
    );
    expect((await w.list({ sort: { by: "title", dir: "asc" } })).body.records?.map((r) => r.title)).toEqual(["a", "b"]);

    for (const bad of [
      {},
      { sorts: null },
      { sorts: ["info"] },
      { sorts: ["nope"] },
      { sorts: ["title", "title"] },
      { sorts: ["title", "rank", "score", "done"] },
    ]) {
      expect((await w.send("/tables/items/sorts/set", bad)).status, JSON.stringify(bad)).toBe(400);
    }
    w.users.current = null;
    expect((await w.send("/tables/items/sorts/set", { sorts: [] })).status).toBe(404);
  });

  it("every declared sort lists both ways, nulls first and ties by id, and walks every row exactly once", async () => {
    const w = await world(["title", "score", "done"]);
    const values = [
      { title: "b", score: 2.5, done: true },
      { title: "a", score: -1, done: false },
      { title: null, score: 2.5 },
      { title: "b", score: null, done: true },
      { title: "B", score: 0.0, done: false },
      { title: "ab", score: 1e10, done: null },
      { title: "a" },
    ];
    const rows: { id: string; fields: Record<string, unknown> }[] = [];
    for (const fields of values) {
      rows.push({ id: (await w.put(fields)).id, fields });
    }
    const contract = (by: string): string[] => {
      const rank = (v: unknown): number => (v === null || v === undefined ? 0 : 1);
      return rows
        .slice()
        .sort((x, y) => {
          const a = x.fields[by] ?? null;
          const b = y.fields[by] ?? null;
          if (rank(a) !== rank(b)) return rank(a) - rank(b);
          if (a !== null && b !== null && a !== b) {
            // ASCII titles: code-unit order is byte order.
            if (typeof a === "string" && typeof b === "string") return a < b ? -1 : 1;
            return Number(a) < Number(b) ? -1 : 1;
          }
          return x.id < y.id ? -1 : 1;
        })
        .map((row) => row.id);
    };
    for (const by of ["title", "score", "done"]) {
      const asc = contract(by);
      const desc = asc.slice().reverse();
      for (const [dir, want] of [
        ["asc", asc],
        ["desc", desc],
      ] as const) {
        for (const limit of [1, 2, 100]) {
          expect(await w.walk({ sort: { by, dir }, limit }), `${by} ${dir} ${limit}`).toEqual(want);
        }
      }
    }
    // "B" sorts before "a": byte order, case-sensitive.
    const titles = (await w.list({ sort: { by: "title", dir: "asc" } })).body.records?.map((r) => r.title);
    expect(titles).toEqual([null, "B", "a", "a", "ab", "b", "b"]);
    // The default is the first sort, descending.
    expect(await w.walk({ limit: 3 })).toEqual(contract("title").reverse());
    for (const body of [
      { order: "newest" },
      { sort: { by: "title", dir: "asc" }, order: "oldest" },
      { sort: { by: "title" } },
      { sort: { by: "title", dir: "up" } },
      { sort: { by: "title", dir: "asc", x: 1 } },
      { sort: "title" },
      { sort: { by: "rank", dir: "asc" } },
    ]) {
      expect(await w.list(body), JSON.stringify(body)).toMatchObject({ status: 400, body: { code: "bad_request" } });
    }
  });

  it("a table without sorts lists every row once in a stable order and takes no sort or order", async () => {
    const w = await world([]);
    const ids = new Set<string>();
    for (let i = 0; i < 7; i += 1) ids.add((await w.put({ title: `r${i}` })).id);
    const first = await w.walk({ limit: 2 });
    expect(await w.walk({ limit: 3 })).toEqual(first);
    expect(new Set(first)).toEqual(ids);
    expect(first).toHaveLength(7);
    expect((await w.count({ where: { title: { begins_with: "r" } } })).total).toBe(7);
    for (const body of [{ order: "newest" }, { sort: { by: "_created_at_ms", dir: "asc" } }]) {
      expect((await w.list(body)).status).toBe(400);
    }
  });

  it("every where operator holds on the value a read returns, and every disallowed one is a 400", async () => {
    const w = await world();
    const r1 = (await w.put({ title: "apple", rank: 1, score: 1.5, done: true, info: { a: 1 } })).id;
    const r2row = await w.put({ title: "banana", rank: 3, score: -2.0, done: false, info: null });
    const r2 = r2row.id;
    const r3row = await w.put({ title: "Apple pie", rank: null, done: true, info: { b: 2 } });
    const r3 = r3row.id;
    // Never wrote title (null), rank (its default 5), done (null), info.
    const r4 = (await w.put({ score: 9 })).id;
    expect((await w.list({ where: { rank: 5 } })).body.records?.[0]?.rank).toBe(5);
    const cases: [unknown, string[]][] = [
      [{ title: "apple" }, [r1]],
      [{ title: { eq: "apple" } }, [r1]],
      [{ title: { ne: "apple" } }, [r2, r3, r4]],
      [{ title: { lt: "b" } }, [r1, r3]],
      [{ title: { lte: "apple" } }, [r1, r3]],
      [{ title: { gt: "apple" } }, [r2]],
      [{ title: { gte: "apple" } }, [r1, r2]],
      [{ title: { between: ["a", "b"] } }, [r1]],
      [{ title: { in: ["banana", "x"] } }, [r2]],
      [{ title: { begins_with: "app" } }, [r1]],
      [{ title: { contains: "pie" } }, [r3]],
      [{ title: { is_null: true } }, [r4]],
      [{ title: { is_null: false } }, [r1, r2, r3]],
      [{ rank: { gte: 3 } }, [r2, r4]],
      [{ rank: 5 }, [r4]],
      [{ rank: { ne: 5 } }, [r1, r2, r3]],
      [{ rank: { lt: 2 } }, [r1]],
      [{ rank: { in: [1, 5] } }, [r1, r4]],
      [{ rank: { between: [2, 5] } }, [r2, r4]],
      [{ rank: { is_null: true } }, [r3]],
      [{ score: { lt: 0 } }, [r2]],
      [{ score: { gt: 1.5 } }, [r4]],
      [{ score: { eq: 9.0 } }, [r4]],
      [{ score: { is_null: true } }, [r3]],
      [{ done: false }, [r2]],
      [{ done: { ne: true } }, [r2, r4]],
      [{ done: { in: [true] } }, [r1, r3]],
      [{ done: { is_null: true } }, [r4]],
      [{ info: { eq: { a: 1 } } }, [r1]],
      [{ info: { is_null: true } }, [r2, r4]],
      [{ photo: { is_null: true } }, [r1, r2, r3, r4]],
      [{ or: [{ rank: 1 }, { done: false }] }, [r1, r2]],
      [{ and: [{ done: true }, { rank: { lte: 1 } }] }, [r1]],
      [{ not: { title: { begins_with: "app" } } }, [r2, r3, r4]],
      [{ _created_at_ms: { gt: r2row._created_at_ms } }, [r3, r4]],
      [{ _updated_at_ms: { between: [r2row._updated_at_ms, r3row._updated_at_ms] } }, [r2, r3]],
      [{ _submitter_user_id: A.id }, [r1, r2, r3, r4]],
      [{}, [r1, r2, r3, r4]],
    ];
    for (const [where, want] of cases) {
      const answer = await w.list({ where });
      expect(answer.status, `${JSON.stringify(where)}: ${JSON.stringify(answer.body)}`).toBe(200);
      expect(new Set(answer.body.records?.map((r) => r.id)), JSON.stringify(where)).toEqual(new Set(want));
      expect((await w.count({ where })).total, `count ${JSON.stringify(where)}`).toBe(want.length);
    }
    // `where` and `eq` are ANDed.
    expect((await w.list({ eq: { done: true }, where: { rank: { lte: 1 } } })).body.records?.map((r) => r.id)).toEqual([
      r1,
    ]);

    for (const bad of [
      { done: { gt: true } },
      { done: { between: [false, true] } },
      { info: { lt: 1 } },
      { info: { ne: { a: 1 } } },
      { photo: { eq: "x" } },
      { rank: { begins_with: "1" } },
      { score: { contains: "1" } },
      { title: { between: [1, 2] } },
      { title: { between: ["b", "a"] } },
      { rank: { in: [] } },
      { rank: { in: Array.from({ length: 101 }, (_, i) => i) } },
      { rank: "x" },
      { rank: 1.5 },
      { rank: {} },
      { rank: { like: 1 } },
      { title: null },
      { title: { ne: null } },
      { nope: 1 },
      { _submitter_handle: "w" },
      { _key: "k" },
      { and: [] },
      { or: [1] },
      { not: [] },
      { not: {} },
      { or: [{}, { rank: 1 }] },
      { and: [{}] },
      [],
      "title",
    ]) {
      const answer = await w.list({ where: bad });
      expect(answer.status, JSON.stringify(bad)).toBe(400);
      expect(answer.body.code).toBe("bad_request");
    }
    for (const nested of [{ not: {} }, { or: [{}, { rank: 1 }] }, { and: [{}] }, { not: { and: [{ rank: 1 }, {}] } }]) {
      expect(await w.list({ where: nested }), JSON.stringify(nested)).toMatchObject({
        status: 400,
        body: { reason: "where: an empty condition {} inside and / or / not names nothing — remove it" },
      });
    }
    // A top-level {} is no condition.
    expect((await w.list({ where: {} })).status).toBe(200);
    // Over DynamoDB's expression limits: a 400, never a 500.
    const many = Array.from({ length: 150 }, (_, i) => ({ rank: { ne: i } }));
    expect(await w.list({ where: { and: many } })).toMatchObject({
      status: 400,
      body: { reason: expect.stringContaining("operators") },
    });
    const longOr = Array.from({ length: 40 }, (_, i) => ({
      title: { in: Array.from({ length: 50 }, (_, j) => `${i}-${j}`) },
    }));
    expect(await w.list({ where: { or: longOr } })).toMatchObject({
      status: 400,
      body: { reason: expect.stringContaining("bytes") },
    });
    // A signed-out caller may not name the submitter.
    w.users.current = null;
    expect((await w.list({ where: { _submitter_user_id: A.id } })).status).toBe(400);
  });

  it("a count answers in parts that add up, ignoring limit and file_urls", async () => {
    const w = await world();
    for (let i = 0; i < 1_003; i += 1) await w.put({ rank: i, done: i < 4 });
    const all = await w.count({});
    expect(all).toEqual({ total: 1_003, parts: 2 });
    expect((await w.count({ where: { done: true } })).total).toBe(4);
    expect((await w.count({ eq: { done: false } })).total).toBe(999);
    expect((await w.count({ order: "oldest", where: { rank: { gte: 1_000 } } })).total).toBe(3);
    const ignored = await w.list({ count: true, limit: 1_000, file_urls: true });
    expect(ignored.status).toBe(200);
    expect(ignored.body.records).toBeUndefined();
    expect((await w.list({ count: "yes" })).status).toBe(400);
  });

  it("a cursor resumes only its sort, direction and the table's sorts, and every old form is malformed", async () => {
    const w = await world();
    await w.send("/tables/items/sorts/set", { sorts: ["_created_at_ms", "rank"] });
    for (let i = 0; i < 4; i += 1) await w.put({ rank: i });
    const page = await w.list({ sort: { by: "rank", dir: "asc" }, limit: 1 });
    const cursor = page.body.next_cursor as string;
    expect(cursor).toMatch(/^m2\./);
    expect((await w.list({ sort: { by: "rank", dir: "asc" }, cursor })).status).toBe(200);
    for (const body of [
      { sort: { by: "rank", dir: "desc" }, cursor },
      { sort: { by: "_created_at_ms", dir: "asc" }, cursor },
      { cursor },
      { order: "oldest", cursor },
      { sort: { by: "rank", dir: "asc" }, cursor: `${cursor}x` },
    ]) {
      expect((await w.list(body)).status, JSON.stringify(body)).toBe(400);
    }
    // The creation-order format of before sorts, the service's earlier
    // `r1.` form, and a cursor of another table are each malformed.
    const other = await w.send("/tables/create", { table: "others", columns: [{ name: "t", type: "text" }], read_group: null, write_group: null });
    expect(other.status).toBe(200);
    for (let i = 0; i < 2; i += 1) {
      expect((await w.send("/tables/others/records/create", { fields: {} })).status).toBe(200);
    }
    const otherCursor = (await w.send("/tables/others/records/list", { limit: 1 })).body.next_cursor as string;
    expect(otherCursor).toMatch(/^m2\./);
    for (const stale of [
      "1700000000000:00000000-0000-4000-8000-000000000001",
      "o:1700000000000:00000000-0000-4000-8000-000000000001",
      "r1.7b22627922",
      otherCursor,
    ]) {
      expect(await w.list({ cursor: stale }), stale).toMatchObject({
        status: 400,
        body: { reason: "malformed cursor — start again without a cursor" },
      });
    }
    // `order` and its `_created_at_ms` sort are one walk.
    const oldest = (await w.list({ order: "oldest", limit: 1 })).body.next_cursor as string;
    expect((await w.list({ sort: { by: "_created_at_ms", dir: "asc" }, cursor: oldest })).status).toBe(200);
    // After the table's sorts changed, every earlier cursor is refused.
    await w.send("/tables/items/sorts/set", { sorts: ["_created_at_ms", "title"] });
    expect(await w.list({ sort: { by: "_created_at_ms", dir: "asc" }, cursor: oldest })).toMatchObject({
      status: 400,
      body: { reason: "the table's sorts changed since this cursor was issued — start again without a cursor" },
    });
  });

  it("every cursor is bound to its caller whatever the read scope, and any sorts/set voids it", async () => {
    const w = await world();
    await w.send("/tables/items/sorts/set", { sorts: ["_created_at_ms", "rank"] });
    await w.send("/tables/items/access/set", { read_group: null, write_group: null, anon_read: true });
    for (let i = 0; i < 4; i += 1) await w.put({ rank: i });
    const rankAsc = { sort: { by: "rank", dir: "asc" }, limit: 1 };
    const resume = (cursor: string) => w.list({ ...rankAsc, cursor });
    const issue = async () => (await w.list(rankAsc)).body.next_cursor as string;
    const anotherCaller = { status: 400, body: { reason: "cursor was issued to another caller — start again without a cursor" } };
    const BACKEND: PilelyUser = { id: null, handle: null, app: "mock-app" };

    // The owner's cursor: only the owner resumes it.
    const owner = await issue();
    expect((await resume(owner)).status).toBe(200);
    w.users.current = B;
    expect(await resume(owner)).toMatchObject(anotherCaller);
    w.users.current = null;
    expect(await resume(owner)).toMatchObject(anotherCaller);

    // A signed-out visitor's: every signed-out visitor resumes it, nobody else.
    const anon = await issue();
    expect((await resume(anon)).status).toBe(200);
    w.users.current = B;
    expect(await resume(anon)).toMatchObject(anotherCaller);
    w.users.current = A;
    expect(await resume(anon)).toMatchObject(anotherCaller);

    // A member's.
    w.users.current = B;
    const member = await issue();
    expect((await resume(member)).status).toBe(200);
    w.users.current = A;
    expect(await resume(member)).toMatchObject(anotherCaller);

    // The db's backend app: its cursor is its own.
    w.users.current = BACKEND;
    const backend = await issue();
    expect((await resume(backend)).status).toBe(200);
    expect(await resume(owner)).toMatchObject(anotherCaller);
    w.users.current = A;
    expect(await resume(backend)).toMatchObject(anotherCaller);

    // The same caller under another read scope.
    await w.send("/tables/items/access/set", { read_group: null, write_group: null, read_scope: "own" });
    w.users.current = B;
    const own = await issue();
    expect((await resume(own)).status).toBe(200);
    w.users.current = A;
    await w.send("/tables/items/access/set", { read_group: null, write_group: null, read_scope: "all" });
    w.users.current = B;
    expect(await resume(own)).toMatchObject({
      status: 400,
      body: { reason: "cursor was issued under another read scope — start again without a cursor" },
    });

    // The owner reads every row whatever the read scope (the service's
    // Rows::All), so a read_scope flip between pages never voids the
    // owner's cursor; a non-owner's and the backend app's walk changes.
    w.users.current = A;
    const ownerAll = await issue();
    w.users.current = BACKEND;
    const backendAll = await issue();
    w.users.current = A;
    await w.send("/tables/items/access/set", { read_group: null, write_group: null, read_scope: "own" });
    expect((await resume(ownerAll)).status).toBe(200);
    const ownerOwn = await issue();
    w.users.current = BACKEND;
    expect(await resume(backendAll)).toMatchObject({
      status: 400,
      body: { reason: "cursor was issued under another read scope — start again without a cursor" },
    });
    w.users.current = A;
    await w.send("/tables/items/access/set", { read_group: null, write_group: null, read_scope: "all" });
    expect((await resume(ownerOwn)).status).toBe(200);

    // Any sorts/set, even with the same sorts, voids every earlier cursor.
    w.users.current = A;
    expect((await resume(owner)).status).toBe(200);
    await w.send("/tables/items/sorts/set", { sorts: ["_created_at_ms", "rank"] });
    expect(await resume(owner)).toMatchObject({
      status: 400,
      body: { reason: "the table's sorts changed since this cursor was issued — start again without a cursor" },
    });
  });

  it("a column never written reads its columns/add default, in reads and in sorts", async () => {
    const w = await world();
    const early = await w.put({ title: "x" });
    expect(early.rank).toBe(5);
    await w.send("/tables/items/sorts/set", { sorts: ["rank"] });
    await w.send("/tables/list", {});
    const late = await w.put({ title: "y", rank: 9 });
    const low = await w.put({ title: "z", rank: 1 });
    expect(await w.walk({ sort: { by: "rank", dir: "asc" } })).toEqual([low.id, early.id, late.id]);
  });
});
