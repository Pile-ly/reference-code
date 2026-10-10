// The in-browser fake of the simple_blob service that `@pilely/core`'s mock
// runtime routes to in mock mode. It answers every route this package's
// wrapper calls with the JSON the real service returns. Uploaded bytes stay
// in memory and `download` answers a `blob:` URL the page can render. Its
// state is memory-only on purpose: the bytes cannot survive a reload, and a
// persisted row whose bytes are gone would be a blob that can never be
// served. Every blob carries the mock app id, so the wrapper's misbound-blob
// guard passes. Writes and listings need a signed-in user; a signed-out call
// and a missing blob answer the uniform bare 404. No access groups, storage
// walls or quotas.
//
// App ownership is modelled here, because the mock context has no notion of
// it: the mock app is owned by `MOCK_APP_OWNER_ID`, the one user mock mode
// signs in. Every blob is bound to the mock app, so every blob is billed to
// that owner (`payer_user_id`) whoever uploaded it (`uploader_user_id`). The
// owner lists and searches every blob of the app (`/apps/{app_id}/list` and
// `/search`) and may delete or re-scope any of them; anyone else lists only
// their own uploads and touches only those. On a blob the owner pays for and
// someone else uploaded, only the owner may turn `anon_read` on.
//
// Reached only from the `isMockMode()` branch in index.ts, so a production
// build carries none of it.

import type { MockReply, MockServiceContext, MockServiceFactory } from "@pilely/core";

import type { BlobCursor, BlobMeta } from "./types.js";

const MARKER = "pilely-mock-fake:simple-blob";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const DISPLAY_NAME_MAX_CHARS = 120;

/** The mock app's owner: `@pilely/core`'s mock user, the one identity mock
 *  mode signs in (and the owner `@pilely/simple-db`'s fake reports for the
 *  mock app). A second user exists only in a hand-built test context. */
export const MOCK_APP_OWNER_ID = "mock-user";

const ANON_READ_OWNER_ONLY = "only the app's owner can turn anon_read on for this blob";

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

  function upload(uploader: string, fields: UploadFields): MockReply {
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
    // Every blob binds to the mock app, so the app's owner pays for it.
    const payer = MOCK_APP_OWNER_ID;
    if (anonRead && uploader !== payer) {
      return ctx.refuse(400, "bad_request", ANON_READ_OWNER_ONLY);
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
      uploader_user_id: uploader,
      payer_user_id: payer,
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

  /** `/list` and `/search` over `rows`: the extension filter on a list, the
   *  `q` prefix match on a search, then one page. */
  function listing(rows: BlobMeta[], search: boolean, input: Record<string, unknown>): MockReply {
    if (search) {
      const q = typeof input.q === "string" ? input.q.trim().toLowerCase() : "";
      if (q === "") return ctx.refuse(400, "bad_request", "q is required");
      return page(
        rows.filter(
          (b) => (b.display_name ?? "").toLowerCase().startsWith(q) || b.extension.toLowerCase().startsWith(q),
        ),
        input,
      );
    }
    const filtered = typeof input.extension === "string" ? rows.filter((b) => b.extension === input.extension) : rows;
    return page(filtered, input);
  }

  /** The uploader and the app's owner may delete or re-scope a blob. */
  function mayManage(user: string, meta: BlobMeta): boolean {
    return user === meta.uploader_user_id || user === MOCK_APP_OWNER_ID;
  }

  function handle(path: string, body: unknown, form: FormData | null): MockReply | null {
    const user = ctx.user()?.id ?? null;
    const input = isObject(body) ? body : {};
    const all = (): BlobMeta[] => [...blobs.values()].map((b) => b.meta);

    if (path === "/upload") {
      if (user === null) return ctx.notFound();
      return upload(user, form ? fieldsFromForm(form) : fieldsFromJson(body));
    }

    // The caller's own uploads.
    if (path === "/list" || path === "/search") {
      if (user === null) return ctx.notFound();
      return listing(
        all().filter((b) => b.uploader_user_id === user),
        path === "/search",
        input,
      );
    }

    // Every blob bound to the app, whoever uploaded it — for the app's owner
    // only; anyone else, and any other app id, gets the uniform 404.
    const appListing = /^\/apps\/([^/]+)\/(list|search)$/.exec(path);
    if (appListing) {
      const listedApp = decodeURIComponent(appListing[1] ?? "");
      if (user !== MOCK_APP_OWNER_ID || listedApp !== ctx.appId) return ctx.notFound();
      const uploader = input.uploader_user_id;
      if (uploader !== undefined && uploader !== null && typeof uploader !== "string") {
        return ctx.refuse(400, "bad_request", "uploader_user_id must be a UUID");
      }
      const rows = all().filter((b) => b.app_id === listedApp && (typeof uploader !== "string" || b.uploader_user_id === uploader));
      return listing(rows, appListing[2] === "search", input);
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
      if (user === null || !stored || !mayManage(user, stored.meta)) return ctx.notFound();
      if (stored.url) URL.revokeObjectURL(stored.url);
      blobs.delete(nanoid);
      return ctx.ok({ ok: true });
    }

    // access/set
    if (user === null || !stored || !mayManage(user, stored.meta)) return ctx.notFound();
    if (!("read_group" in input)) return ctx.refuse(400, "bad_request", "read_group is required");
    if (input.read_group !== null && typeof input.read_group !== "string") {
      return ctx.refuse(400, "bad_request", "read_group must be a string or null");
    }
    const anonRead = input.anon_read === true;
    if (anonRead && input.read_group !== null) {
      return ctx.refuse(400, "bad_request", "anon_read requires read_group null");
    }
    const ownerPaid = stored.meta.payer_user_id !== stored.meta.uploader_user_id;
    if (anonRead && ownerPaid && user !== stored.meta.payer_user_id) {
      return ctx.refuse(400, "bad_request", ANON_READ_OWNER_ONLY);
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
