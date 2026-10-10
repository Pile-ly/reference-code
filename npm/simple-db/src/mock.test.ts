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
  getRecord,
  listAllRecords,
  listApps,
  listRecords,
  listTables,
  setNewRowEmail,
  setTableAccess,
  updateRecord,
} from "./api.js";
import { createSimpleDbFake } from "./mock.js";
import type { DbListPage, DbRecord } from "./types.js";

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

  it("pages oldest first with an oldest cursor, each row exactly once, eq included", async () => {
    for (let i = 0; i < 5; i += 1) {
      await createRecord("posts", { title: `p${i}`, likes: i % 2 });
    }
    const first = await listRecords<Post>("posts", { limit: 2, order: "oldest" });
    expect(first.records.map((r) => r.title)).toEqual(["p0", "p1"]);
    expect(first.next_cursor).toEqual(expect.stringMatching(/^o:\d+:/));

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
      expect(page.next_cursor).toEqual(expect.stringMatching(/^\d+:/));
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
      () => listRecords("posts", { cursor: "o:nope", order: "oldest" }),
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
