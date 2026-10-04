import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock mode is a build-time switch read when modules load, so it is set
// before any import below is evaluated.
vi.hoisted(() => {
  vi.stubEnv("VITE_PILELY_MOCK", "1");
});

import { appId, PilelyError, resetMock } from "@pilely/core";
import type { PilelyClient } from "@pilely/core";
import {
  deleteBlob,
  downloadUrl,
  listAllBlobs,
  listBlobs,
  searchBlobs,
  setBlobAccess,
  upload,
  uploadBase64,
} from "./api.js";

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

  it("drops blobs on reset, bytes and rows together", async () => {
    await upload(png(), { extension: "png", content_type: "image/png", read_group: null });
    resetMock();
    expect((await listBlobs()).blobs).toEqual([]);
  });
});
