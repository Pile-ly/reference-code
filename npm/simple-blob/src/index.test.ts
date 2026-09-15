import { afterEach, describe, expect, it, vi } from "vitest";
import { PilelyError } from "@pilely/core";
import type { PilelyClient } from "@pilely/core";
import {
  deleteBlob,
  downloadUrl,
  listAllBlobs,
  listBlobs,
  searchAllBlobs,
  searchBlobs,
  setBlobAccess,
  upload,
  uploadBase64,
} from "./index.js";
import type { BlobMeta } from "./types.js";

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

function urlOf(fetchImpl: ReturnType<typeof vi.fn>, call = 0): string {
  return String(fetchImpl.mock.calls[call]?.[0]);
}

const boundBlob: BlobMeta = {
  blob_nanoid: "b1",
  display_name: null,
  extension: "png",
  content_type: "image/png",
  size_bytes: 10,
  app_id: "app-1",
  read_group: null,
  anon_read: false,
  created_time_stamp: 1,
};

describe("simple-blob: every route maps to the correct URL", () => {
  const base = "https://simple-blob.pilely.app";

  const cases: [string, () => Promise<unknown>, string][] = [
    [
      "upload",
      () =>
        upload(new Blob(["x"]), { extension: "png", content_type: "image/png", read_group: null }),
      `${base}/upload`,
    ],
    ["listBlobs", () => listBlobs(), `${base}/list`],
    ["searchBlobs", () => searchBlobs("q"), `${base}/search`],
    ["setBlobAccess", () => setBlobAccess("b1", { read_group: null }), `${base}/blobs/b1/access/set`],
    ["deleteBlob", () => deleteBlob("b1"), `${base}/blobs/b1/delete`],
    ["downloadUrl", () => downloadUrl("b1"), `${base}/blobs/b1/download`],
  ];

  it.each(cases)("%s hits the correct path", async (_name, run, expectedUrl) => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        ok: true,
        blob: boundBlob,
        blobs: [],
        next_cursor: null,
        url: "https://cdn.example/x",
        content_type: "image/png",
        size_bytes: 10,
      }),
    );
    stubWindow(fetchImpl);
    await run();
    expect(urlOf(fetchImpl)).toBe(expectedUrl);
  });

  it("covers exactly the 6 registered POST action routes", () => {
    expect(cases).toHaveLength(6);
  });
});

describe("upload", () => {
  it("sends a FormData body with no content-type header, the file part named blob", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, blob: boundBlob }));
    stubWindow(fetchImpl);
    await upload(new Blob(["x"]), { extension: "png", content_type: "image/png", read_group: null });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["content-type"]).toBeUndefined();
    const form = init.body as FormData;
    expect(form.get("blob")).toBeInstanceOf(Blob);
    expect(form.get("read_group")).toBe("null");
  });

  it("rejects and deletes the orphan when the answer's blob.app_id is null", async () => {
    const misbound: BlobMeta = { ...boundBlob, app_id: null };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, blob: misbound }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    stubWindow(fetchImpl);

    await expect(
      upload(new Blob(["x"]), { extension: "png", content_type: "image/png", read_group: null }),
    ).rejects.toBeInstanceOf(PilelyError);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(urlOf(fetchImpl, 1)).toBe("https://simple-blob.pilely.app/blobs/b1/delete");
  });

  it("does not call delete when app_id is bound", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, blob: boundBlob }));
    stubWindow(fetchImpl);
    await upload(new Blob(["x"]), { extension: "png", content_type: "image/png", read_group: null });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("uploadBase64", () => {
  it("sends blob_base64 as JSON, with a real null/boolean read_group and anon_read", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, blob: boundBlob }));
    stubWindow(fetchImpl);
    await uploadBase64("eA==", {
      extension: "png",
      content_type: "image/png",
      read_group: null,
      anon_read: true,
    });
    const init = fetchImpl.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ blob_base64: "eA==", read_group: null, anon_read: true });
  });

  it("also rejects a misbound blob", async () => {
    const misbound: BlobMeta = { ...boundBlob, app_id: null };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, blob: misbound }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    stubWindow(fetchImpl);
    await expect(
      uploadBase64("eA==", { extension: "png", content_type: "image/png", read_group: null }),
    ).rejects.toBeInstanceOf(PilelyError);
  });
});

describe("listAllBlobs / searchAllBlobs", () => {
  it("listAllBlobs walks a two-page cursor to the end, sending limit: 100 on every page", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          ok: true,
          blobs: [{ ...boundBlob, blob_nanoid: "b1" }],
          next_cursor: { after_created_time_stamp: 1, after_blob_nanoid: "b1" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { ok: true, blobs: [{ ...boundBlob, blob_nanoid: "b2" }], next_cursor: null }),
      );
    stubWindow(fetchImpl);
    const rows = await listAllBlobs();
    expect(rows).toHaveLength(2);
    for (const call of fetchImpl.mock.calls) {
      const init = call[1] as RequestInit;
      expect(JSON.parse(init.body as string).limit).toBe(100);
    }
  });

  it("searchAllBlobs walks a two-page cursor to the end, sending limit: 100 on every page", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          ok: true,
          blobs: [{ ...boundBlob, blob_nanoid: "b1" }],
          next_cursor: { after_created_time_stamp: 1, after_blob_nanoid: "b1" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, { ok: true, blobs: [{ ...boundBlob, blob_nanoid: "b2" }], next_cursor: null }),
      );
    stubWindow(fetchImpl);
    const rows = await searchAllBlobs("q");
    expect(rows).toHaveLength(2);
    for (const call of fetchImpl.mock.calls) {
      const init = call[1] as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body.limit).toBe(100);
      expect(body.q).toBe("q");
    }
  });
});

describe("deleteBlob", () => {
  it("resolves on a 404", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(404, null));
    stubWindow(fetchImpl);
    await expect(deleteBlob("b1")).resolves.toBeUndefined();
  });

  it("throws on a 500", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(500, { ok: false, code: "internal", reason: "simple-blob answered 500" }),
    );
    stubWindow(fetchImpl);
    await expect(deleteBlob("b1")).rejects.toBeInstanceOf(PilelyError);
  });
});

describe("nesting asymmetry", () => {
  it("upload nests under blob; download is flat", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, blob: boundBlob }))
      .mockResolvedValueOnce(
        jsonResponse(200, { ok: true, url: "https://cdn.example/x", content_type: "image/png", size_bytes: 10 }),
      );
    stubWindow(fetchImpl);
    const uploaded = await upload(new Blob(["x"]), {
      extension: "png",
      content_type: "image/png",
      read_group: null,
    });
    expect(uploaded.blob_nanoid).toBe("b1");
    const dl = await downloadUrl("b1");
    expect(dl).toEqual({ url: "https://cdn.example/x", content_type: "image/png", size_bytes: 10 });
  });
});
