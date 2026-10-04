// The in-browser fake of the simple_blob service that `@pilely/core`'s mock
// runtime routes to in mock mode. It answers every route this package's
// wrapper calls with the JSON the real service returns. Uploaded bytes stay
// in memory and `download` answers a `blob:` URL the page can render. Its
// state is memory-only on purpose: the bytes cannot survive a reload, and a
// persisted row whose bytes are gone would be a blob that can never be
// served. Every blob carries the mock app id, so the wrapper's misbound-blob
// guard passes. Writes need a signed-in user; a signed-out write and a
// missing blob answer the uniform bare 404. No access groups, storage walls
// or quotas. Reached only from the `isMockMode()` branch in index.ts, so a
// production build carries none of it.

import type { MockReply, MockServiceContext, MockServiceFactory } from "@pilely/core";

import type { BlobCursor, BlobMeta } from "./types.js";

const MARKER = "pilely-mock-fake:simple-blob";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const DISPLAY_NAME_MAX_CHARS = 120;

interface StoredBlob {
  meta: BlobMeta;
  bytes: Blob;
  url: string | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Newest first: created DESC, then nanoid DESC — the service's order. */
function newestFirst(a: BlobMeta, b: BlobMeta): number {
  if (a.created_time_stamp !== b.created_time_stamp) return b.created_time_stamp - a.created_time_stamp;
  return a.blob_nanoid < b.blob_nanoid ? 1 : a.blob_nanoid > b.blob_nanoid ? -1 : 0;
}

function decodeBase64(text: string): Uint8Array | null {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

interface UploadFields {
  bytes: Blob | null;
  extension: unknown;
  content_type: unknown;
  read_group: unknown;
  anon_read: unknown;
  display_name: unknown;
}

function fieldsFromForm(form: FormData): UploadFields {
  const blob = form.get("blob");
  const readGroup = form.get("read_group");
  const anonRead = form.get("anon_read");
  return {
    bytes: blob instanceof Blob ? blob : null,
    extension: form.get("extension"),
    content_type: form.get("content_type"),
    read_group: readGroup === "null" ? null : readGroup,
    anon_read: anonRead === null ? undefined : anonRead === "true" ? true : anonRead === "false" ? false : anonRead,
    display_name: form.get("display_name") ?? undefined,
  };
}

function fieldsFromJson(body: unknown): UploadFields {
  const input = isObject(body) ? body : {};
  const decoded = typeof input.blob_base64 === "string" ? decodeBase64(input.blob_base64) : null;
  return {
    bytes: decoded ? new Blob([decoded as Uint8Array<ArrayBuffer>]) : null,
    extension: input.extension,
    content_type: input.content_type,
    read_group: input.read_group,
    anon_read: input.anon_read,
    display_name: input.display_name,
  };
}

export const createSimpleBlobFake: MockServiceFactory = (ctx: MockServiceContext) => {
  const blobs = new Map<string, StoredBlob>();

  function upload(fields: UploadFields): MockReply {
    if (!fields.bytes || fields.bytes.size === 0) {
      return ctx.refuse(400, "bad_request", "blob bytes are required");
    }
    if (typeof fields.extension !== "string" || fields.extension === "") {
      return ctx.refuse(400, "bad_request", "extension is required");
    }
    if (typeof fields.content_type !== "string" || fields.content_type === "") {
      return ctx.refuse(400, "bad_request", "content_type is required");
    }
    if (fields.read_group !== null && typeof fields.read_group !== "string") {
      return ctx.refuse(400, "bad_request", "read_group is required");
    }
    if (fields.anon_read !== undefined && typeof fields.anon_read !== "boolean") {
      return ctx.refuse(400, "bad_request", "anon_read must be true or false");
    }
    const anonRead = fields.anon_read === true;
    if (anonRead && fields.read_group !== null) {
      return ctx.refuse(400, "bad_request", "anon_read requires read_group null");
    }
    let displayName: string | null = null;
    if (fields.display_name !== undefined && fields.display_name !== null) {
      const length = typeof fields.display_name === "string" ? [...fields.display_name].length : 0;
      if (length < 1 || length > DISPLAY_NAME_MAX_CHARS) {
        return ctx.refuse(400, "bad_request", "display_name must be 1..=120 characters");
      }
      displayName = fields.display_name as string;
    }
    const meta: BlobMeta = {
      blob_nanoid: ctx.nanoid(),
      display_name: displayName,
      extension: fields.extension,
      content_type: fields.content_type,
      size_bytes: fields.bytes.size,
      app_id: ctx.appId,
      read_group: fields.read_group,
      anon_read: anonRead,
      created_time_stamp: ctx.now(),
    };
    const bytes = new Blob([fields.bytes], { type: fields.content_type });
    blobs.set(meta.blob_nanoid, { meta, bytes, url: null });
    return ctx.ok({ ok: true, blob: { ...meta } });
  }

  function page(rows: BlobMeta[], body: Record<string, unknown>): MockReply {
    const rawLimit = body.limit === undefined || body.limit === null ? DEFAULT_PAGE_SIZE : Number(body.limit);
    const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : DEFAULT_PAGE_SIZE));
    const hasMs = body.after_created_time_stamp !== undefined && body.after_created_time_stamp !== null;
    const hasId = body.after_blob_nanoid !== undefined && body.after_blob_nanoid !== null;
    if (hasMs !== hasId) {
      return ctx.refuse(400, "bad_request", "cursor needs both after_created_time_stamp and after_blob_nanoid");
    }
    let sorted = [...rows].sort(newestFirst);
    if (hasMs) {
      const afterMs = Number(body.after_created_time_stamp);
      const afterId = String(body.after_blob_nanoid);
      sorted = sorted.filter(
        (b) => b.created_time_stamp < afterMs || (b.created_time_stamp === afterMs && b.blob_nanoid < afterId),
      );
    }
    const pageRows = sorted.slice(0, limit);
    const last = pageRows[pageRows.length - 1];
    // The service hands back a cursor whenever the page is full, so a full
    // last page is followed by one empty page.
    const nextCursor: BlobCursor | null =
      pageRows.length === limit && last
        ? { after_created_time_stamp: last.created_time_stamp, after_blob_nanoid: last.blob_nanoid }
        : null;
    return ctx.ok({ ok: true, blobs: pageRows.map((b) => ({ ...b })), next_cursor: nextCursor });
  }

  function handle(path: string, body: unknown, form: FormData | null): MockReply | null {
    const signedIn = ctx.user() !== null;
    const input = isObject(body) ? body : {};

    if (path === "/upload") {
      if (!signedIn) return ctx.notFound();
      return upload(form ? fieldsFromForm(form) : fieldsFromJson(body));
    }

    if (path === "/list") {
      const all = [...blobs.values()].map((b) => b.meta);
      const rows = typeof input.extension === "string" ? all.filter((b) => b.extension === input.extension) : all;
      return page(rows, input);
    }

    if (path === "/search") {
      const q = typeof input.q === "string" ? input.q.trim().toLowerCase() : "";
      if (q === "") return ctx.refuse(400, "bad_request", "q is required");
      const rows = [...blobs.values()]
        .map((b) => b.meta)
        .filter(
          (b) => (b.display_name ?? "").toLowerCase().startsWith(q) || b.extension.toLowerCase().startsWith(q),
        );
      return page(rows, input);
    }

    const match = /^\/blobs\/([^/]+)\/(download|delete|access\/set)$/.exec(path);
    if (!match) return null;
    const nanoid = decodeURIComponent(match[1] ?? "");
    const action = match[2];
    const stored = blobs.get(nanoid);

    if (action === "download") {
      if (!stored) return ctx.notFound();
      if (!stored.url) stored.url = URL.createObjectURL(stored.bytes);
      return ctx.ok({
        ok: true,
        url: stored.url,
        content_type: stored.meta.content_type,
        size_bytes: stored.meta.size_bytes,
      });
    }

    if (action === "delete") {
      if (!signedIn || !stored) return ctx.notFound();
      if (stored.url) URL.revokeObjectURL(stored.url);
      blobs.delete(nanoid);
      return ctx.ok({ ok: true });
    }

    // access/set
    if (!signedIn || !stored) return ctx.notFound();
    if (!("read_group" in input)) return ctx.refuse(400, "bad_request", "read_group is required");
    if (input.read_group !== null && typeof input.read_group !== "string") {
      return ctx.refuse(400, "bad_request", "read_group must be a string or null");
    }
    const anonRead = input.anon_read === true;
    if (anonRead && input.read_group !== null) {
      return ctx.refuse(400, "bad_request", "anon_read requires read_group null");
    }
    stored.meta.read_group = input.read_group;
    stored.meta.anon_read = anonRead;
    return ctx.ok({ ok: true, blob: { ...stored.meta } });
  }

  function dispose(): void {
    for (const stored of blobs.values()) {
      if (stored.url) URL.revokeObjectURL(stored.url);
    }
    blobs.clear();
  }

  return {
    marker: MARKER,
    handle: (request) => handle(request.path, request.body, request.form),
    dispose,
  };
};
