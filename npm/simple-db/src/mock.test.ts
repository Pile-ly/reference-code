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
  setSorts,
  setTableAccess,
  updateRecord,
} from "./api.js";
import { createSimpleDbFake, MOCK_ANON_GROUP, MOCK_AUTH_GROUP, MOCK_UPLOAD_PATH } from "./mock.js";
import { CALLER_ID, NIL_SUBMITTER_ID } from "./types.js";
import type { DbFile, DbListPage, DbPolicies, DbRecord, DbUploadTicket } from "./types.js";

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

/** A fake behind a context whose caller the test switches, answering
 *  `{status, body}` for a path under the mock app. */
function switchableFake(users: { current: PilelyUser | null }, load?: () => unknown) {
  let slice: unknown = load?.();
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
    nanoid: (length = 21) => String((ids += 1)).padStart(length, "a"),
    ok: (body, status = 200) => ({ status, body }),
    notFound: () => ({ status: 404 }),
    refuse: (status, code, reason) => ({ status, body: { ok: false, code, reason } }),
  };
  const fake = createSimpleDbFake(ctx);
  const send = async (
    path: string,
    body: unknown,
    form: FormData | null = null,
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const full = path.startsWith(MOCK_UPLOAD_PATH) ? path : `/apps/mock-app${path}`;
    const reply = (await fake.handle({ path: full, body, form })) as MockReply;
    return { status: reply.status, body: (reply.body ?? {}) as Record<string, unknown> };
  };
  return send;
}

/** The db's owner (the first caller, so the app's `owner_handle`), another
 *  signed-in person, and the app's backend server. */
const OWNER: PilelyUser = { id: "u-owner", handle: "owner", app: "mock-app" };
const PERSON: PilelyUser = { id: "u-b", handle: "b", app: "mock-app" };
const BACKEND: PilelyUser = { id: null, handle: null, app: "mock-app" };
const OWN_ROWS = { _submitter_user_id: CALLER_ID };

/** A world on one table `t` the owner creates with `policies`. */
async function policyWorld(policies: DbPolicies, denyGroup: string | null = null) {
  const users: { current: PilelyUser | null } = { current: OWNER };
  const send = switchableFake(users);
  const created = await send("/tables/create", {
    table: "t",
    columns: [
      { name: "title", type: "text" },
      { name: "status", type: "text" },
      { name: "rank", type: "integer" },
      { name: "photo", type: "file" },
    ],
    policies,
    deny_group: denyGroup,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(200);
  const as = (user: PilelyUser | null) => {
    users.current = user;
  };
  const create = async (user: PilelyUser | null, fields: Record<string, unknown>) => {
    as(user);
    const reply = await send("/tables/t/records/create", { fields });
    expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    return reply.body.record as Record<string, unknown> & { id: string };
  };
  const titles = async (user: PilelyUser | null, body: Record<string, unknown> = {}) => {
    as(user);
    const reply = await send("/tables/t/records/list", { order: "oldest", ...body });
    expect(reply.status, JSON.stringify(reply.body)).toBe(200);
    return (reply.body.records as { title: string }[]).map((r) => r.title);
  };
  const upload = async (user: PilelyUser | null) => {
    as(user);
    const started = await send("/tables/t/files/photo/upload/start", { content_type: "image/png" });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const uploadId = started.body.upload_id as string;
    const form = new FormData();
    form.append("file", new Blob(["png!"]));
    form.append("content_type", "image/png");
    expect((await send(`${MOCK_UPLOAD_PATH}${uploadId}`, undefined, form)).status).toBe(200);
    return uploadId;
  };
  return { users, send, as, create, titles, upload, created: created.body };
}

describe("simple-db fake: tables carry policies and deny_group", () => {
  const POLICIES: DbPolicies = {
    "records/list": [
      { group: "staffGroup1", rows: {} },
      { group: MOCK_AUTH_GROUP, rows: OWN_ROWS },
    ],
    "records/create": [
      { group: MOCK_ANON_GROUP, rows: {} },
      { group: MOCK_AUTH_GROUP, rows: {} },
    ],
  };
  const messages = { table: "messages", columns: [{ name: "body", type: "text" as const }] };

  it("tables/create stores them, and every table route answers with them", async () => {
    const created = await createTable({ ...messages, policies: POLICIES, deny_group: "bans1" });
    expect(created).toMatchObject({ name: "messages", policies: POLICIES, deny_group: "bans1" });
    expect(created).not.toHaveProperty("read_group");
    expect((await listTables()).tables).toEqual([created]);
    expect(await addColumn("messages", { name: "read", type: "boolean" })).toMatchObject({
      policies: POLICIES,
      deny_group: "bans1",
    });
    expect(await setSorts("messages", [])).toMatchObject({ policies: POLICIES, deny_group: "bans1" });
  });

  it("tables/create without them makes every API owner-only and no deny group", async () => {
    expect(await createTable(messages)).toMatchObject({ policies: {}, deny_group: null });
    expect(await createTable({ ...messages, table: "nulls", policies: {}, deny_group: null })).toMatchObject({
      policies: {},
      deny_group: null,
    });
  });

  it("access/set replaces both whole and answers the table's name, access and sorts", async () => {
    await createTable({ ...messages, policies: POLICIES, deny_group: "bans1" });
    const opened = { "records/get": [{ group: MOCK_AUTH_GROUP, rows: { body: { $ne: null } } }] };
    expect(await setTableAccess("messages", { policies: opened, deny_group: null })).toEqual({
      table: "messages",
      policies: opened,
      deny_group: null,
      sorts: [{ by: "_created_at_ms", state: "ready" }],
    });
    expect((await listTables()).tables[0]).toMatchObject({ policies: opened, deny_group: null });
    // Sending back what tables/list answered works.
    const [listed] = (await listTables()).tables;
    if (!listed) throw new Error("tables/list lost the table");
    expect(await setTableAccess("messages", { policies: listed.policies, deny_group: listed.deny_group })).toMatchObject({
      policies: opened,
    });
    expect(await setTableAccess("messages", { policies: {}, deny_group: null })).toMatchObject({ policies: {} });
  });

  it("refuses each removed setting with a 400 naming its replacement, before anything else", async () => {
    await createTable(messages);
    for (const setting of [
      "read_group",
      "write_group",
      "anon_read",
      "read_scope",
      "mutate_scope",
      "mutate_group",
      "audience_column",
    ]) {
      for (const value of [null, "x"]) {
        // The table name is taken: the removed setting answers first, never 409.
        const create = call({ service: "simple-db", path: "/apps/mock-app/tables/create", body: { ...messages, [setting]: value } });
        await expect(create, setting).rejects.toMatchObject({ status: 400, code: "bad_request" });
        await create.catch((error: PilelyError) =>
          expect(error.message).toContain(`\`${setting}\` is removed — use \`policies\``),
        );
        const set = call({
          service: "simple-db",
          path: "/apps/mock-app/tables/messages/access/set",
          body: { policies: {}, deny_group: null, [setting]: value },
        });
        await expect(set, setting).rejects.toMatchObject({ status: 400, code: "bad_request" });
      }
    }
    const reason = await call({ service: "simple-db", path: "/apps/mock-app/tables/create", body: { ...messages, read_group: null } }).catch(
      (error: PilelyError) => error.message,
    );
    expect(reason).toContain("records/list, records/get and files/download");
    expect((await listTables()).tables[0]).toMatchObject({ policies: {}, deny_group: null });
  });

  it("refuses every malformed access with the service's 400 and changes nothing", async () => {
    const columns = [
      { name: "title", type: "text" as const },
      { name: "count", type: "integer" as const },
      { name: "done", type: "boolean" as const },
      { name: "meta", type: "json" as const },
      { name: "photo", type: "file" as const },
    ];
    const G = "staffGroup1";
    const many = Array.from({ length: 101 }, (_, i) => `v${i}`);
    // 160 `$ne`s, each rendered as `(NOT #n = :v)`: over 300 operators.
    const huge = { $or: Array.from({ length: 160 }, (_, i) => ({ title: { $ne: `v${i}` } })) };
    const cases: [unknown, string][] = [
      [[], "policies must be an object"],
      [{ "records/everything": [{ group: G, rows: {} }] }, "unknown policy key `records/everything`"],
      [{ "records/list": {} }, "must be a list of {group, rows}"],
      [{ "records/list": [] }, "is an empty list"],
      [{ "records/list": ["g"] }, "must be an object {group, rows}"],
      [{ "records/list": [{ group: G, rows: {}, mode: "x" }] }, "has the unknown key `mode`"],
      [{ "records/list": [{ rows: {} }] }, "is missing `group`"],
      [{ "records/list": [{ group: G }] }, "is missing `rows`"],
      [{ "files/upload/start": [{ group: G }] }, "is missing `rows`"],
      [{ "records/list": [{ group: 7, rows: {} }] }, "`group` must be a simple_group id"],
      [{ "records/list": [{ group: "has space", rows: {} }] }, "simple_group id (ASCII letters and digits)"],
      [{ "records/get": [{ group: G, rows: [] }] }, "a filter must be an object"],
      [{ "records/get": [{ group: G, rows: { nope: 1 } }] }, "unknown field `nope`"],
      [{ "records/get": [{ group: G, rows: { title: { $regex: "x" } } }] }, "unknown operator `$regex`"],
      [{ "records/get": [{ group: G, rows: { count: "seven" } }] }, "takes a integer value"],
      [{ "records/get": [{ group: G, rows: { done: { $gt: true } } }] }, "a boolean field takes"],
      [{ "records/get": [{ group: G, rows: { meta: { $in: [1] } } }] }, "a json field takes"],
      [{ "records/get": [{ group: G, rows: { photo: "x" } }] }, "a file field compares only with null"],
      [{ "records/get": [{ group: G, rows: { $where: "1" } }] }, "not a top-level operator"],
      [{ "records/get": [{ group: G, rows: { $not: { title: "a" } } }] }, "not a top-level operator"],
      [{ "records/get": [{ group: G, rows: { $and: [] } }] }, "`$and` takes a non-empty array"],
      [{ "records/get": [{ group: G, rows: { count: CALLER_ID } }] }, "only a text field compares with it"],
      [{ "records/get": [{ group: G, rows: { title: { $gt: CALLER_ID } } }] }, "compares only with $eq, $ne, $in and $nin"],
      [{ "records/get": [{ group: G, rows: { count: { $gte: null } } }] }, "takes a value, not null"],
      [{ "records/get": [{ group: G, rows: { title: { $in: [] } } }] }, "takes an array of 1 to 100 values"],
      [{ "records/get": [{ group: G, rows: { title: { $nin: many } } }] }, "takes an array of 1 to 100 values"],
      [{ "records/get": [{ group: G, rows: { title: { $exists: 1 } } }] }, "$exists takes true or false"],
      [{ "records/get": [{ group: G, rows: { count: { $not: 3 } } }] }, "$not takes an operator object"],
      [{ "records/get": [{ group: G, rows: { title: { $eq: "a", x: 1 } } }] }, "holds only operators"],
      [{ "records/get": [{ group: G, rows: { title: { a: 1 } } }] }, "must hold operators"],
      [{ "records/get": [{ group: G, rows: huge }] }, "DynamoDB takes at most"],
    ];
    await createTable({ table: "t", columns });
    for (const [policies, needle] of cases) {
      for (const path of ["/apps/mock-app/tables/create", "/apps/mock-app/tables/t/access/set"]) {
        const body = path.endsWith("create") ? { table: "fresh", columns, policies } : { policies, deny_group: null };
        const reason = await call({ service: "simple-db", path, body }).then(
          () => "accepted",
          (error: PilelyError) => `${error.status} ${error.code} ${error.message}`,
        );
        expect(reason, JSON.stringify(policies).slice(0, 120)).toContain("400 bad_request");
        expect(reason, JSON.stringify(policies).slice(0, 120)).toContain(needle);
      }
    }
    for (const [body, needle] of [
      [{ policies: {} }, "deny_group is required"],
      [{ deny_group: null }, "policies is required"],
      [{}, "policies is required"],
      [{ policies: {}, deny_group: "" }, "deny_group is empty"],
      [{ policies: {}, deny_group: "not a group" }, "deny_group must be a simple_group id"],
      [{ policies: {}, deny_group: MOCK_ANON_GROUP }, "ACTIVE simple_group owned by you"],
      [{ policies: {}, deny_group: MOCK_AUTH_GROUP }, "ACTIVE simple_group owned by you"],
    ] as const) {
      const reason = await call({ service: "simple-db", path: "/apps/mock-app/tables/t/access/set", body }).then(
        () => "accepted",
        (error: PilelyError) => `${error.status} ${error.message}`,
      );
      expect(reason, JSON.stringify(body)).toContain("400");
      expect(reason, JSON.stringify(body)).toContain(needle);
    }
    expect((await listTables()).tables.map((t) => [t.name, t.policies, t.deny_group])).toEqual([["t", {}, null]]);
    // A filter on a column the table declares later is refused until then.
    const later = { "records/get": [{ group: G, rows: { tag: "x" } }] };
    await expect(setTableAccess("t", { policies: later, deny_group: null })).rejects.toMatchObject({ status: 400 });
    await addColumn("t", { name: "tag", type: "text" });
    expect(await setTableAccess("t", { policies: later, deny_group: null })).toMatchObject({ policies: later });
  });

  it("accepts every operator per type, null and $$CALLER_ID where the service does, and either global group", async () => {
    const policies: DbPolicies = {
      "records/list": [
        {
          group: MOCK_ANON_GROUP,
          rows: {
            title: { $eq: "a", $ne: null, $gt: "a", $gte: "a", $lt: "z", $lte: "z", $in: ["a", null, CALLER_ID], $nin: [CALLER_ID] },
            count: { $exists: true, $not: { $gt: 3 } },
            done: { $in: [true, false] },
            meta: { a: 1 },
            photo: null,
            _created_at_ms: { $gt: 0 },
            $or: [{ _submitter_user_id: CALLER_ID }, { _updated_at_ms: { $lte: 9e15 } }],
            $nor: [{ title: "x" }],
            $and: [{}],
          },
        },
      ],
      "files/upload/start": [{ group: MOCK_AUTH_GROUP, rows: {} }],
    };
    const created = await createTable({
      table: "t",
      columns: [
        { name: "title", type: "text" },
        { name: "count", type: "integer" },
        { name: "done", type: "boolean" },
        { name: "meta", type: "json" },
        { name: "photo", type: "file" },
      ],
      policies,
    });
    expect(created.policies).toEqual(policies);
  });

  it("reads a table persisted before policies as the policies its old settings were migrated to", async () => {
    const legacy = (settings: Record<string, unknown>) => ({
      name: "legacy",
      created_at_ms: 1,
      columns: [{ name: "to_user_id", type: "text" }],
      implicit: false,
      records: [],
      ...settings,
    });
    const users = { current: OWNER as PilelyUser | null };
    const persisted = (settings: Record<string, unknown>) => () => ({
      apps: {
        "mock-app": { app_id: "mock-app", owner_handle: "owner", created_time_stamp: 1, implicit: false, tables: { legacy: legacy(settings) } },
      },
    });
    const policiesOf = async (settings: Record<string, unknown>) => {
      const send = switchableFake(users, persisted(settings));
      return ((await send("/tables/list", {})).body.tables as { policies: DbPolicies; deny_group: unknown }[])[0];
    };
    const open = [{ group: MOCK_AUTH_GROUP, rows: {} }];
    expect(await policiesOf({ read_group: null, write_group: null, anon_read: false })).toEqual(
      expect.objectContaining({
        policies: {
          "records/list": open,
          "records/get": open,
          "files/download": open,
          "records/create": open,
          "files/upload/start": open,
        },
        deny_group: null,
      }),
    );
    const own = { _submitter_user_id: CALLER_ID };
    const addressed = { $or: [{ to_user_id: null }, { to_user_id: CALLER_ID }] };
    const reads = [
      { group: "readers1", rows: { $or: [own, { to_user_id: CALLER_ID }] } },
      { group: MOCK_ANON_GROUP, rows: {} },
      { group: "staff1", rows: {} },
    ];
    expect(
      await policiesOf({
        read_group: "readers1",
        write_group: "writers1",
        anon_read: true,
        read_scope: "own",
        audience_column: "to_user_id",
        mutate_scope: "own",
        mutate_group: "staff1",
        deny_group: "bans1",
      }),
    ).toEqual(
      expect.objectContaining({
        policies: {
          "records/list": reads,
          "records/get": reads,
          "files/download": reads,
          "records/create": [{ group: "writers1", rows: addressed }],
          "records/update": [
            { group: "staff1", rows: {} },
            { group: "writers1", rows: { $and: [own, addressed] } },
          ],
          "records/delete": [
            { group: "staff1", rows: {} },
            { group: "writers1", rows: own },
          ],
          "files/upload/start": [
            { group: "writers1", rows: {} },
            { group: "staff1", rows: {} },
          ],
        },
        deny_group: "bans1",
      }),
    );
    // access/set replaces the old settings for good.
    const send = switchableFake(users, persisted({ read_group: "readers1", write_group: null, anon_read: true }));
    expect(await send("/tables/legacy/access/set", { policies: {}, deny_group: null })).toEqual({
      status: 200,
      body: { ok: true, table: "legacy", policies: {}, deny_group: null, sorts: [{ by: "_created_at_ms", state: "ready" }] },
    });
    expect(((await send("/tables/list", {})).body.tables as unknown[])[0]).toMatchObject({ policies: {} });
  });
});

describe("simple-db fake: callers are admitted by the policies", () => {
  it("an own-rows list through the authenticated group's $$CALLER_ID filter: the owner lists every row, others only theirs", async () => {
    const w = await policyWorld({
      "records/list": [
        { group: "staffGroup1", rows: {} },
        { group: MOCK_AUTH_GROUP, rows: OWN_ROWS },
      ],
      "records/get": [{ group: MOCK_AUTH_GROUP, rows: OWN_ROWS }],
      "records/create": [{ group: MOCK_AUTH_GROUP, rows: {} }],
    });
    await w.create(OWNER, { title: "o1" });
    const b1 = await w.create(PERSON, { title: "b1" });
    await w.create(PERSON, { title: "b2" });
    const c = await w.create({ id: "u-c", handle: "c", app: "mock-app" }, { title: "c1" });

    expect(await w.titles(OWNER)).toEqual(["o1", "b1", "b2", "c1"]);
    // The fake has no group membership: the staff group holds nobody, so
    // every other signed-in person lists only their own rows.
    expect(await w.titles(PERSON)).toEqual(["b1", "b2"]);
    w.as(PERSON);
    expect((await w.send("/tables/t/records/list", { count: true })).body).toEqual({ ok: true, count: 2, next_cursor: null });
    expect((await w.send(`/tables/t/records/${b1.id}/get`, {})).status).toBe(200);
    expect((await w.send(`/tables/t/records/${c.id}/get`, {})).status).toBe(404);
    // A page walk with a cursor keeps to the caller's rows.
    const first = await w.send("/tables/t/records/list", { order: "oldest", limit: 1 });
    expect((first.body.records as { title: string }[]).map((r) => r.title)).toEqual(["b1"]);
    const second = await w.send("/tables/t/records/list", { order: "oldest", limit: 1, cursor: first.body.next_cursor });
    expect((second.body.records as { title: string }[]).map((r) => r.title)).toEqual(["b2"]);
    expect(second.body.next_cursor).toBeNull();
    // Neither a signed-out visitor nor the backend app is in the
    // authenticated group.
    w.as(null);
    expect((await w.send("/tables/t/records/list", {})).status).toBe(404);
    w.as(BACKEND);
    expect((await w.send("/tables/t/records/list", {})).status).toBe(404);
    expect((await w.send("/tables/t/records/create", { fields: { title: "x" } })).status).toBe(404);
  });

  it("a signed-out list, get and download reach only what the anonymous group's filter allows, never _submitter_user_id", async () => {
    const published = [{ group: MOCK_ANON_GROUP, rows: { status: "published" } }];
    const w = await policyWorld({
      "records/list": published,
      "records/get": published,
      "files/download": published,
    });
    const photo = await w.upload(OWNER);
    const out = await w.create(OWNER, { title: "out", status: "published", photo: { upload: photo } });
    const draftPhoto = await w.upload(OWNER);
    const draft = await w.create(OWNER, { title: "wip", status: "draft", photo: { upload: draftPhoto } });

    w.as(null);
    const listed = await w.send("/tables/t/records/list", { file_urls: true });
    expect(listed.status).toBe(200);
    const records = listed.body.records as Record<string, unknown>[];
    expect(records.map((r) => r.title)).toEqual(["out"]);
    expect(records[0]).not.toHaveProperty("_submitter_user_id");
    expect(records[0]).toMatchObject({ _submitter_handle: "owner", photo: { url: expect.any(String) } });
    expect((await w.send("/tables/t/records/list", { count: true })).body.count).toBe(1);
    const got = await w.send(`/tables/t/records/${out.id}/get`, {});
    expect(got.status).toBe(200);
    expect(got.body.record).not.toHaveProperty("_submitter_user_id");
    expect((await w.send(`/tables/t/records/${draft.id}/get`, {})).status).toBe(404);
    expect((await w.send(`/tables/t/records/${out.id}/files/photo/download`, {})).status).toBe(200);
    expect((await w.send(`/tables/t/records/${draft.id}/files/photo/download`, {})).status).toBe(404);
    // A signed-in person is in no policy's group here.
    expect((await w.send("/tables/t/records/list", {}, null)).status).toBe(200);
    w.as(PERSON);
    expect((await w.send("/tables/t/records/list", {})).status).toBe(404);
    expect(await w.titles(OWNER)).toEqual(["out", "wip"]);
  });

  it("file_urls signs a link only on the records a files/download policy admits the caller on", async () => {
    const w = await policyWorld({
      "records/list": [{ group: MOCK_AUTH_GROUP, rows: {} }],
      "files/download": [{ group: MOCK_AUTH_GROUP, rows: { status: "published" } }],
    });
    for (const status of ["published", "draft"]) {
      await w.create(OWNER, { title: status, status, photo: { upload: await w.upload(OWNER) } });
    }
    w.as(PERSON);
    const listed = (await w.send("/tables/t/records/list", { file_urls: true, order: "oldest" })).body.records as {
      photo: { url?: string };
    }[];
    expect(listed.map((r) => typeof r.photo.url)).toEqual(["string", "undefined"]);
  });

  it("a $$CALLER_ID filter never holds for a signed-out visitor: an empty list and a count of 0", async () => {
    const w = await policyWorld({ "records/list": [{ group: MOCK_ANON_GROUP, rows: OWN_ROWS }] });
    await w.create(OWNER, { title: "o1" });
    w.as(null);
    expect((await w.send("/tables/t/records/list", {})).body).toEqual({ ok: true, records: [], next_cursor: null });
    expect((await w.send("/tables/t/records/list", { count: true })).body).toEqual({ ok: true, count: 0, next_cursor: null });
  });

  it("a signed-out visitor creates with an upload attached, stamped with the nil UUID; key is a 400", async () => {
    const w = await policyWorld({
      "records/create": [{ group: MOCK_ANON_GROUP, rows: { status: "new" } }],
      "files/upload/start": [{ group: MOCK_ANON_GROUP, rows: {} }],
    });
    const photo = await w.upload(null);
    w.as(null);
    const created = await w.send("/tables/t/records/create", {
      fields: { title: "contact me", status: "new", photo: { upload: photo } },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const record = created.body.record as Record<string, unknown> & { id: string };
    expect(record).not.toHaveProperty("_submitter_user_id");
    expect(record).toMatchObject({ _submitter_handle: "", photo: { content_type: "image/png", size_bytes: 4 } });
    // Every signed-out visitor is one caller: the upload id is the secret.
    const shared = await w.upload(null);
    expect((await w.send("/tables/t/records/create", { fields: { status: "new", photo: { upload: shared } } })).status).toBe(200);

    expect(await w.send("/tables/t/records/create", { fields: { status: "new" }, key: "k1" })).toMatchObject({
      status: 400,
      body: { code: "bad_request", reason: "key needs a signed-in caller — a signed-out visitor creates without one" },
    });
    // A new row outside the policy's filter is the uniform 404.
    expect((await w.send("/tables/t/records/create", { fields: { status: "spam" } })).status).toBe(404);
    expect((await w.send("/tables/t/records/create", { fields: {} })).status).toBe(404);

    w.as(OWNER);
    const stored = await w.send(`/tables/t/records/${record.id}/get`, {});
    expect(stored.body.record).toMatchObject({ _submitter_user_id: NIL_SUBMITTER_ID, _submitter_handle: "", title: "contact me" });
    // A signed-in person is in no create or upload policy here.
    w.as(PERSON);
    expect((await w.send("/tables/t/records/create", { fields: { status: "new" } })).status).toBe(404);
    expect((await w.send("/tables/t/files/photo/upload/start", { content_type: "image/png" })).status).toBe(404);
  });

  it("a signed-out visitor never updates or deletes, whatever the policies say", async () => {
    const anyone = [{ group: MOCK_ANON_GROUP, rows: {} }];
    const w = await policyWorld({ "records/list": anyone, "records/update": anyone, "records/delete": anyone });
    const row = await w.create(OWNER, { title: "x" });
    w.as(null);
    expect((await w.send("/tables/t/records/list", {})).status).toBe(200);
    expect((await w.send(`/tables/t/records/${row.id}/update`, { fields: { title: "y" } })).status).toBe(404);
    expect((await w.send(`/tables/t/records/${row.id}/delete`, {})).status).toBe(404);
    expect(await w.titles(OWNER)).toEqual(["x"]);
  });

  it("an update needs one policy to hold on the row before and after; a delete a matching row", async () => {
    const open = [{ group: MOCK_AUTH_GROUP, rows: { status: "open" } }];
    const w = await policyWorld({ "records/update": open, "records/delete": open });
    const a = await w.create(OWNER, { title: "a", status: "open", rank: 1 });
    const closed = await w.create(OWNER, { title: "c", status: "closed" });
    w.as(PERSON);
    expect((await w.send(`/tables/t/records/${a.id}/update`, { fields: { title: "a2" } })).status).toBe(200);
    expect((await w.send(`/tables/t/records/${a.id}/update`, { inc: { rank: 1 } })).status).toBe(200);
    // The row after would not match: refused and unchanged.
    expect((await w.send(`/tables/t/records/${a.id}/update`, { fields: { status: "closed" } })).status).toBe(404);
    expect((await w.send(`/tables/t/records/${closed.id}/update`, { fields: { status: "open" } })).status).toBe(404);
    expect((await w.send(`/tables/t/records/${a.id}/update`, { fields: { title: "a3" }, if_version: 1 })).status).toBe(409);
    expect((await w.send(`/tables/t/records/${closed.id}/delete`, {})).status).toBe(404);
    expect((await w.send(`/tables/t/records/${a.id}/delete`, { if_version: 1 })).status).toBe(409);
    expect((await w.send(`/tables/t/records/${a.id}/delete`, {})).status).toBe(200);
    w.as(OWNER);
    expect((await w.send(`/tables/t/records/${closed.id}/update`, { fields: { status: "open" } })).status).toBe(200);

    // Two policies, each holding on one side only, never admit the change.
    const two = await policyWorld({
      "records/update": [
        { group: MOCK_AUTH_GROUP, rows: { status: "open" } },
        { group: MOCK_AUTH_GROUP, rows: { status: "closed" } },
      ],
    });
    const row = await two.create(OWNER, { status: "open" });
    two.as(PERSON);
    expect((await two.send(`/tables/t/records/${row.id}/update`, { fields: { status: "closed" } })).status).toBe(404);
    expect((await two.send(`/tables/t/records/${row.id}/update`, { fields: { title: "t" } })).status).toBe(200);
  });

  it("a policy-limited update answers in the service's order: row before 404, inc range 400, 409s, then row after 404", async () => {
    const open = [{ group: MOCK_AUTH_GROUP, rows: { status: "open" } }];
    const w = await policyWorld({ "records/list": open, "records/get": open, "records/update": open });
    const a = await w.create(OWNER, { title: "a", status: "open", rank: 1 });
    const closed = await w.create(OWNER, { title: "c", status: "closed", rank: 1 });
    const outOfRange = { inc: { rank: 2 ** 63 } };
    w.as(PERSON);
    // A row outside the caller's filter reads like no row: never the 400.
    expect((await w.send(`/tables/t/records/${closed.id}/update`, outOfRange)).status).toBe(404);
    expect((await w.send(`/tables/t/records/${closed.id}/update`, { fields: { title: "c2" }, if_version: 99 })).status).toBe(404);
    expect((await w.send(`/tables/t/records/${closed.id}/update`, { fields: { title: "c2" }, if: { title: "no" } })).status).toBe(404);
    // A row the caller may change answers the 400 before anything after.
    const ranged = await w.send(`/tables/t/records/${a.id}/update`, { ...outOfRange, fields: { status: "closed" } });
    expect(ranged).toMatchObject({ status: 400, body: { code: "bad_request" } });
    // Before matches, after fails: a stale if_version or a failing if still
    // answers its 409 before the row-after 404.
    const stale = await w.send(`/tables/t/records/${a.id}/update`, { fields: { status: "closed" }, if_version: 99 });
    expect(stale).toMatchObject({ status: 409, body: { code: "version_conflict", current_version: 1 } });
    const failing = await w.send(`/tables/t/records/${a.id}/update`, { fields: { status: "closed" }, if: { title: "no" } });
    expect(failing).toMatchObject({ status: 409, body: { code: "condition_failed" } });
    // With the 409s cleared, the row after decides: the uniform 404.
    const after = await w.send(`/tables/t/records/${a.id}/update`, { fields: { status: "closed" }, if_version: 1, if: { title: "a" } });
    expect(after.status).toBe(404);
    // Every refusal changed nothing.
    expect((await w.send(`/tables/t/records/${a.id}/get`, {})).body.record).toMatchObject({ status: "open", rank: 1, _version: 1 });
  });

  it("a deny_group names a group the fake holds nobody in, so it denies nobody; the owner bypasses every policy", async () => {
    const w = await policyWorld({ "records/create": [{ group: MOCK_AUTH_GROUP, rows: {} }] }, "bans1");
    expect((await w.create(PERSON, { title: "b" })).title).toBe("b");
    // No list policy at all: owner-only.
    w.as(PERSON);
    expect((await w.send("/tables/t/records/list", {})).status).toBe(404);
    expect(await w.titles(OWNER)).toEqual(["b"]);
    w.as(OWNER);
    const upload = await w.send("/tables/t/files/photo/upload/start", { content_type: "image/png" });
    expect(upload.status).toBe(200);
  });

  it("a table created on first use is open: every signed-in person reads and writes, signed-out visitors only read", async () => {
    const users = { current: OWNER as PilelyUser | null };
    const send = switchableFake(users);
    const made = await send("/tables/notes/records/create", { fields: { body: "o" } });
    expect(made.status).toBe(200);
    expect(((await send("/tables/list", {})).body.tables as { policies: DbPolicies }[])[0]?.policies).toMatchObject({
      "records/list": [
        { group: MOCK_AUTH_GROUP, rows: {} },
        { group: MOCK_ANON_GROUP, rows: {} },
      ],
      "records/create": [{ group: MOCK_AUTH_GROUP, rows: {} }],
    });
    users.current = PERSON;
    const id = (made.body.record as { id: string }).id;
    expect((await send(`/tables/notes/records/${id}/update`, { fields: { body: "b" } })).status).toBe(200);
    users.current = null;
    expect((await send("/tables/notes/records/list", {})).status).toBe(200);
    expect((await send(`/tables/notes/records/${id}/get`, {})).status).toBe(200);
    expect((await send("/tables/notes/records/create", { fields: { body: "anon" } })).status).toBe(404);
    expect((await send("/tables/notes/files/f/upload/start", { content_type: "a/b" })).status).toBe(404);
  });

  it("every cursor is bound to the policies that admitted its caller", async () => {
    const w = await policyWorld({
      "records/list": [{ group: MOCK_AUTH_GROUP, rows: {} }],
      "records/create": [{ group: MOCK_AUTH_GROUP, rows: {} }],
    });
    for (let i = 0; i < 3; i += 1) await w.create(PERSON, { title: `b${i}` });
    w.as(PERSON);
    const cursor = (await w.send("/tables/t/records/list", { limit: 1 })).body.next_cursor;
    expect((await w.send("/tables/t/records/list", { limit: 1, cursor })).status).toBe(200);
    w.as(OWNER);
    const ownerCursor = (await w.send("/tables/t/records/list", { limit: 1 })).body.next_cursor;
    await w.send("/tables/t/access/set", {
      policies: { "records/list": [{ group: MOCK_AUTH_GROUP, rows: OWN_ROWS }] },
      deny_group: null,
    });
    // The owner reads the whole table whatever the policies.
    expect((await w.send("/tables/t/records/list", { limit: 1, cursor: ownerCursor })).status).toBe(200);
    w.as(PERSON);
    expect(await w.send("/tables/t/records/list", { limit: 1, cursor })).toMatchObject({
      status: 400,
      body: { reason: "cursor was issued under other access policies — start again without a cursor" },
    });
  });
});

describe("simple-db fake: new_row_email", () => {
  const inbox = { table: "inbox", columns: [{ name: "body", type: "text" as const }] };
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
    const access = await setTableAccess("inbox", { policies: {}, deny_group: null });
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
                legacy: { name: "legacy", policies: {}, deny_group: null, created_at_ms: 1, columns: [], implicit: false, records: [] },
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

describe("simple-db fake: eq on _submitter_user_id", () => {
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

  it("filters by submitter within the rows the caller may list, and refuses the filter signed out", async () => {
    const users: { current: PilelyUser | null } = { current: A };
    const send = fakeWith(users);
    const everyone = [
      { group: MOCK_AUTH_GROUP, rows: {} },
      { group: MOCK_ANON_GROUP, rows: {} },
    ];
    expect(
      (
        await send("/tables/create", {
          table: "notes",
          columns: [{ name: "body", type: "text" }],
          policies: { "records/list": everyone, "records/create": everyone },
        })
      ).status,
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
    const open = [{ group: MOCK_AUTH_GROUP, rows: {} }];
    const readers = [...open, { group: MOCK_ANON_GROUP, rows: {} }];
    expect(notes).toEqual({
      name: "notes",
      policies: {
        "records/list": readers,
        "records/get": readers,
        "files/download": readers,
        "records/create": open,
        "records/update": open,
        "records/delete": open,
        "files/upload/start": open,
      },
      deny_group: null,
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
    });
    expect(table.columns).toEqual([{ name: "title", type: "text" }]);
    expect(table.policies).toEqual({});
    await expect(createTable({ table: "posts", columns: [] })).rejects.toMatchObject({
      status: 409,
      code: "table_exists",
    });

    const withColumn = await addColumn("posts", { name: "likes", type: "integer", default: 0 });
    expect(withColumn.columns.map((c) => c.name)).toEqual(["title", "likes"]);
    await expect(addColumn("posts", { name: "likes", type: "integer" })).rejects.toMatchObject({
      status: 409,
      code: "column_exists",
    });

    const policies = { "records/create": [{ group: "g1", rows: {} }] };
    expect(await setTableAccess("posts", { policies, deny_group: null })).toEqual({
      table: "posts",
      policies,
      deny_group: null,
      sorts: [{ by: "_created_at_ms", state: "ready" }],
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
      await createTable({ table: `t${i}`, columns: [] });
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

  /** Every signed-in person and signed-out visitor reads and writes every
   *  row of `items`, as on a table opened to both platform-wide groups. */
  const everyone = [
    { group: MOCK_AUTH_GROUP, rows: {} },
    { group: MOCK_ANON_GROUP, rows: {} },
  ];
  const OPEN_ITEMS = {
    "records/list": everyone,
    "records/get": everyone,
    "files/download": everyone,
    "records/create": everyone,
    "records/update": everyone,
    "records/delete": everyone,
    "files/upload/start": everyone,
  };

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
      policies: OPEN_ITEMS,
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
    const other = await w.send("/tables/create", { table: "others", columns: [{ name: "t", type: "text" }] });
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

  it("every cursor is bound to its caller and the policies that admitted it, and any sorts/set voids it", async () => {
    const w = await world();
    await w.send("/tables/items/sorts/set", { sorts: ["_created_at_ms", "rank"] });
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

    // The db's backend app is in neither platform-wide group: it lists
    // only through a group it is an app member of, which the fake has none
    // of.
    w.users.current = BACKEND;
    expect((await w.list(rankAsc)).status).toBe(404);

    // The same caller under other admitting policies.
    w.users.current = A;
    const ownRows = [{ group: MOCK_AUTH_GROUP, rows: { _submitter_user_id: CALLER_ID } }];
    await w.send("/tables/items/access/set", { policies: { ...OPEN_ITEMS, "records/list": ownRows }, deny_group: null });
    w.users.current = B;
    for (let i = 0; i < 2; i += 1) {
      expect((await w.send("/tables/items/records/create", { fields: { rank: 10 + i } })).status).toBe(200);
    }
    const own = await issue();
    expect((await resume(own)).status).toBe(200);
    w.users.current = A;
    await w.send("/tables/items/access/set", { policies: OPEN_ITEMS, deny_group: null });
    w.users.current = B;
    expect(await resume(own)).toMatchObject({
      status: 400,
      body: { reason: "cursor was issued under other access policies — start again without a cursor" },
    });

    // The owner reads every row whatever the policies, so an access change
    // between pages never voids the owner's cursor.
    w.users.current = A;
    const ownerAll = await issue();
    await w.send("/tables/items/access/set", { policies: { ...OPEN_ITEMS, "records/list": ownRows }, deny_group: null });
    expect((await resume(ownerAll)).status).toBe(200);
    await w.send("/tables/items/access/set", { policies: OPEN_ITEMS, deny_group: null });

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
