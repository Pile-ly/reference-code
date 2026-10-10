import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock mode is a build-time switch read when modules load, so it is set
// before any import below is evaluated.
vi.hoisted(() => {
  vi.stubEnv("VITE_PILELY_MOCK", "1");
});

import { appId, PilelyError, resetMock } from "@pilely/core";
import type { MockReply, MockServiceContext, PilelyClient, PilelyUser } from "@pilely/core";
import {
  deleteBlob,
  downloadUrl,
  listAllBlobs,
  listAppBlobs,
  listBlobs,
  searchAppBlobs,
  searchBlobs,
  setBlobAccess,
  upload,
  uploadBase64,
} from "./api.js";
import { createSimpleBlobFake, MOCK_APP_OWNER_ID } from "./mock.js";
import type { BlobMeta } from "./types.js";

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

const png = () => new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: "image/png" });

describe("simple-blob fake", () => {
  it("upload → downloadUrl → delete through the real wrapper", async () => {
    const blob = await upload(png(), {
      extension: "png",
      content_type: "image/png",
      read_group: null,
      display_name: "cat",
    });
    expect(blob).toEqual({
      blob_nanoid: expect.stringMatching(/^[A-Za-z0-9]+$/),
      display_name: "cat",
      extension: "png",
      content_type: "image/png",
      size_bytes: 7,
      app_id: "mock-app",
      read_group: null,
      anon_read: false,
      // The mock user owns the mock app: its own upload is billed to itself.
      uploader_user_id: "mock-user",
      payer_user_id: "mock-user",
      created_time_stamp: expect.any(Number),
    });

    const download = await downloadUrl(blob.blob_nanoid);
    expect(download).toEqual({ url: expect.stringMatching(/^blob:/), content_type: "image/png", size_bytes: 7 });

    await deleteBlob(blob.blob_nanoid);
    await expect(downloadUrl(blob.blob_nanoid)).rejects.toMatchObject({ status: 404, code: null });
    // A second delete is the swallowed 404.
    await expect(deleteBlob(blob.blob_nanoid)).resolves.toBeUndefined();
  });

  it("serves the uploaded bytes at the blob: URL", async () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    const blob = await upload(png(), { extension: "png", content_type: "image/png", read_group: null });
    const { url } = await downloadUrl(blob.blob_nanoid);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL.mock.results[0]?.value).toBe(url);
    const served = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(served.type).toBe("image/png");
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71, 1, 2, 3]));
    createObjectURL.mockRestore();
  });

  it("accepts the base64 path too", async () => {
    const blob = await uploadBase64(btoa("hello"), { extension: "txt", content_type: "text/plain", read_group: null });
    expect(blob.size_bytes).toBe(5);
    expect(blob.display_name).toBeNull();
  });

  it("lists newest first, handing a cursor back on every full page", async () => {
    for (const name of ["a", "b", "c"]) {
      await upload(png(), { extension: "png", content_type: "image/png", read_group: null, display_name: name });
    }
    const first = await listBlobs({ limit: 3 });
    expect(first.blobs.map((b) => b.display_name)).toEqual(["c", "b", "a"]);
    expect(first.next_cursor).not.toBeNull();
    const after = await listBlobs({ limit: 3, ...first.next_cursor });
    expect(after).toEqual({ blobs: [], next_cursor: null });
    expect((await listAllBlobs()).map((b) => b.display_name)).toEqual(["c", "b", "a"]);
    expect((await searchBlobs("B")).blobs.map((b) => b.display_name)).toEqual(["b"]);
    await expect(searchBlobs("  ")).rejects.toMatchObject({ status: 400, code: "bad_request" });
  });

  it("sets access in the real nested shape", async () => {
    const blob = await upload(png(), { extension: "png", content_type: "image/png", read_group: "g1" });
    const updated = await setBlobAccess(blob.blob_nanoid, { read_group: null, anon_read: true });
    expect(updated).toMatchObject({ blob_nanoid: blob.blob_nanoid, read_group: null, anon_read: true });
  });

  it("refuses a signed-out upload with the bare 404, then accepts it after signIn", async () => {
    pilely().signOut();
    const attempt = upload(png(), { extension: "png", content_type: "image/png", read_group: null });
    await expect(attempt).rejects.toBeInstanceOf(PilelyError);
    await expect(
      upload(png(), { extension: "png", content_type: "image/png", read_group: null }),
    ).rejects.toMatchObject({ status: 404, code: null });
    await pilely().signIn();
    await expect(
      upload(png(), { extension: "png", content_type: "image/png", read_group: null }),
    ).resolves.toMatchObject({ app_id: "mock-app" });
  });

  it("lists and searches the whole app for its owner, through the real wrapper", async () => {
    const app = "mock-app";
    expect(appId()).toBe(app);
    for (const name of ["a", "b", "c"]) {
      await upload(png(), { extension: "png", content_type: "image/png", read_group: null, display_name: name });
    }
    const first = await listAppBlobs(app, { limit: 2 });
    expect(first.blobs.map((b) => b.display_name)).toEqual(["c", "b"]);
    expect(first.blobs[0]).toMatchObject({ uploader_user_id: "mock-user", payer_user_id: "mock-user" });
    const rest = await listAppBlobs(app, { limit: 2, cursor: first.next_cursor });
    expect(rest).toEqual({ blobs: [expect.objectContaining({ display_name: "a" })], next_cursor: null });
    expect((await searchAppBlobs(app, "B")).blobs.map((b) => b.display_name)).toEqual(["b"]);
    expect((await listAppBlobs(app, { uploaderUserId: "someone-else" })).blobs).toEqual([]);
    await expect(searchAppBlobs(app, " ")).rejects.toMatchObject({ status: 400, code: "bad_request" });
    // Another app's listing, and a signed-out caller: the uniform bare 404.
    await expect(listAppBlobs("another-app")).rejects.toMatchObject({ status: 404, code: null });
    pilely().signOut();
    await expect(listAppBlobs(app)).rejects.toMatchObject({ status: 404, code: null });
    await expect(listBlobs()).rejects.toMatchObject({ status: 404, code: null });
  });

  it("drops blobs on reset, bytes and rows together", async () => {
    await upload(png(), { extension: "png", content_type: "image/png", read_group: null });
    resetMock();
    // Reset signs out too, and a listing needs a signed-in caller.
    await pilely().signIn();
    expect((await listBlobs()).blobs).toEqual([]);
  });
});

// The fake behind a hand-built context, so a visitor can upload through the
// owner's app: the mock runtime itself only ever signs in one user.
describe("simple-blob fake: the app owner and a visitor", () => {
  function harness() {
    let current: PilelyUser | null = null;
    let tick = 0;
    const ctx: MockServiceContext = {
      appId: "mock-app",
      user: () => current,
      load: () => undefined,
      save: () => undefined,
      now: () => ++tick,
      uuid: () => `uuid-${++tick}`,
      nanoid: () => `b${String(++tick).padStart(3, "0")}`,
      ok: (body, status = 200) => ({ status, body }),
      notFound: () => ({ status: 404 }),
      refuse: (status, code, reason) => ({ status, body: { ok: false, code, reason } }),
    };
    const fake = createSimpleBlobFake(ctx);
    const post = (path: string, body: unknown = {}) => fake.handle({ path, body, form: null }) as MockReply;
    const as = (id: string | null) => {
      current = id === null ? null : { id, handle: id, app: "mock-app" };
    };
    const put = (body: Record<string, unknown> = {}) =>
      post("/upload", { blob_base64: btoa("hi"), extension: "txt", content_type: "text/plain", read_group: null, ...body });
    const blobOf = (reply: MockReply) => (reply.body as { blob: BlobMeta }).blob;
    const rowsOf = (reply: MockReply) => (reply.body as { blobs: BlobMeta[] }).blobs.map((b) => b.blob_nanoid);
    return { post, as, put, blobOf, rowsOf };
  }

  const owner = MOCK_APP_OWNER_ID;

  it("bills a visitor's upload to the app's owner and names both", () => {
    const { as, put, blobOf } = harness();
    as("visitor");
    const reply = put();
    expect(reply.status).toBe(200);
    expect(blobOf(reply)).toMatchObject({ app_id: "mock-app", uploader_user_id: "visitor", payer_user_id: owner });
  });

  it("lets the owner list, search, filter, re-scope and delete a visitor's upload; nobody else lists the app", () => {
    const { post, as, put, blobOf, rowsOf } = harness();
    as("visitor");
    const theirs = blobOf(put({ display_name: "note" })).blob_nanoid;
    as(owner);
    const mine = blobOf(put()).blob_nanoid;

    expect(rowsOf(post("/apps/mock-app/list"))).toEqual([mine, theirs]);
    expect(rowsOf(post("/apps/mock-app/list", { uploader_user_id: "visitor" }))).toEqual([theirs]);
    expect(rowsOf(post("/apps/mock-app/search", { q: "no" }))).toEqual([theirs]);
    expect(post("/apps/mock-app/list", { uploader_user_id: 7 })).toMatchObject({ status: 400 });
    expect(post("/apps/other-app/list")).toEqual({ status: 404 });
    // `/list` stays the caller's own uploads.
    expect(rowsOf(post("/list"))).toEqual([mine]);

    as("visitor");
    expect(post("/apps/mock-app/list")).toEqual({ status: 404 });
    expect(post("/apps/mock-app/search", { q: "no" })).toEqual({ status: 404 });
    expect(rowsOf(post("/list"))).toEqual([theirs]);

    as(owner);
    const opened = post(`/blobs/${theirs}/access/set`, { read_group: null, anon_read: true });
    expect(opened.status).toBe(200);
    expect(blobOf(opened)).toMatchObject({ anon_read: true, uploader_user_id: "visitor", payer_user_id: owner });
    expect(post(`/blobs/${theirs}/delete`)).toMatchObject({ status: 200 });
    as("visitor");
    expect(post(`/blobs/${theirs}/delete`)).toEqual({ status: 404 });
  });

  it("refuses the visitor's anon_read on an owner-paid blob, on upload and on access/set", () => {
    const { post, as, put, blobOf } = harness();
    as("visitor");
    expect(put({ anon_read: true })).toMatchObject({
      status: 400,
      body: { code: "bad_request", reason: "only the app's owner can turn anon_read on for this blob" },
    });
    expect(post("/list")).toMatchObject({ body: { blobs: [] } });

    const id = blobOf(put({ read_group: "g-owner" })).blob_nanoid;
    expect(post(`/blobs/${id}/access/set`, { read_group: null, anon_read: true })).toMatchObject({ status: 400 });
    const narrowed = post(`/blobs/${id}/access/set`, { read_group: null });
    expect(narrowed.status).toBe(200);
    expect(blobOf(narrowed)).toMatchObject({ read_group: null, anon_read: false });
  });

  it("answers a third user the uniform 404 on someone else's blob", () => {
    const { post, as, put, blobOf } = harness();
    as("visitor");
    const id = blobOf(put()).blob_nanoid;
    as("third");
    expect(post(`/blobs/${id}/access/set`, { read_group: null })).toEqual({ status: 404 });
    expect(post(`/blobs/${id}/delete`)).toEqual({ status: 404 });
  });
});
