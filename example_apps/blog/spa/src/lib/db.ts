// The blog's whole "backend": a thin client over the platform's managed
// database, simple_db (manual: https://pilely.app/skill/app_management/simple_db).
//
// Flow: page → SimpleDb.<verb>() → window.pilely.fetch (attaches the app
// token, silently re-mints, holds an anonymous credential for signed-out
// visitors on a public app) → https://simple-db.<apex>/apps/<app_id>/tables/…
//
// Three contract points that are easy to get wrong, all handled here so
// screens never think about them:
//
//  1. WRITES NEST, READS ARE FLAT. You send `{"fields": {"title": "…"}}`
//     but the columns come back at the TOP LEVEL of `record`, beside `id`
//     and the `_`-prefixed server-minted fields — not under `fields`.
//  2. LISTS ARE PAGED. `records/list` answers at most 100 rows and a
//     `next_cursor`; `listAll` walks the cursor to the end.
//  3. EVERY DENIAL IS A UNIFORM 404 — byte-identical to "no such table".
//     Never read a 404 as proof something doesn't exist; check sign-in,
//     app, and group membership first. UI never gates on these statuses
//     (it gates on `window.pilely.user()` — see the session store).

/** Server-minted fields present on every record; you never declare these. */
export interface DbRecord {
  id: string;
  _submitter_handle: string;
  /** Absent for anonymous readers of an `anon_read` table (privacy). */
  _submitter_user_id?: string;
  _created_at_ms: number;
  _updated_at_ms: number;
}

// ── The blog's four tables (columns are all `text`; see build_instruction.md) ──

export interface PostRecord extends DbRecord {
  title: string;
  subtitle: string;
  body_md: string;
}

/** Same shape as a post — drafts live in their own OWNER-ONLY table, never
 *  as a flag on `posts` (a shared-read table exposes every record). */
export type DraftRecord = PostRecord;

export interface CommentRecord extends DbRecord {
  /** `id` of the `posts` record this comment belongs to. */
  post_id: string;
  body: string;
}

export interface LikeRecord extends DbRecord {
  post_id: string;
}

export type BlogTable = "posts" | "drafts" | "comments" | "likes";

/** A failed simple_db call. `status` 404 is a uniform denial (or a truly
 *  missing record — indistinguishable by design); 429 rate limit; 503 the
 *  app owner is out of traffic credit. */
export class DbError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    reason: string,
  ) {
    super(reason);
    this.name = "DbError";
  }
}

// Envelopes: create/get/update → {ok, record}; list → {ok, records,
// next_cursor}; delete → {ok, deleted}.
interface RecordEnvelope<T> {
  ok: boolean;
  record: T;
}
interface ListEnvelope<T> {
  ok: boolean;
  records: T[];
  next_cursor: string | null;
}

/**
 * The simple-db service host. `simple-*` labels are reserved and fixed —
 * the ONE permitted hardcode exception in the SPA standard — but deriving
 * them from the apex the client script was loaded from keeps this bundle
 * portable to a self-hosted instance for free.
 */
function simpleDbOrigin(): string {
  const apex = window.pilely?.apexOrigin() ?? "https://pilely.app";
  return apex.replace("://", "://simple-db.");
}

/** The registered pile id, declared once in index.html's
 *  `<meta name="pilely-app">` tag (build_instruction.md step 2). */
function appId(): string {
  const id = window.pilely?.appId();
  if (!id) {
    throw new Error("pilely client not loaded or <meta name=\"pilely-app\"> missing");
  }
  return id;
}

/** POST one simple_db route through the platform client and unwrap the
 *  envelope. Every route is POST-to-act; `Accept: application/json` selects
 *  the JSON shape. */
async function call<E extends { ok: boolean }>(path: string, body: unknown): Promise<E> {
  const pilely = window.pilely;
  if (!pilely) throw new Error("pilely client not loaded");
  // Auth state MUST be settled before the first data call (standard §0:
  // "call before first render"). Skipping this races the client's boot-time
  // anonymous mint on a public app: the call goes out tokenless, the
  // service answers 401, and client.js — reading a tokenless 401 as an
  // expired USER token — starts the interactive sign-in dance, bouncing a
  // signed-out visitor to the login page. After boot this await is free.
  await pilely.ready;
  const res = await pilely.fetch(`${simpleDbOrigin()}/apps/${appId()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  // Denials arrive as bare statuses (uniform 404) or an {ok:false, code,
  // reason} envelope; normalize both into DbError.
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // empty body (the uniform 404) — fall through with nulls
  }
  const envelope = json as (E & { code?: string; reason?: string }) | null;
  if (!res.ok || !envelope?.ok) {
    throw new DbError(
      res.status,
      envelope?.code ?? null,
      envelope?.reason ?? `simple_db answered ${res.status}`,
    );
  }
  return envelope;
}

/** Static-method namespace over the record routes (the CRUD the SPA uses). */
export class SimpleDb {
  /** Walk `records/list` to the end (100 rows per page, cursor until null).
   *  `eq` is the server-side equality filter — reach for it before
   *  client-side filtering ("the comments on this post" is `eq`). */
  static async listAll<T extends DbRecord>(
    table: BlogTable,
    eq?: Record<string, string>,
  ): Promise<T[]> {
    const all: T[] = [];
    let cursor: string | null = null;
    do {
      const page: ListEnvelope<T> = await call<ListEnvelope<T>>(
        `/tables/${table}/records/list`,
        { limit: 100, ...(cursor ? { cursor } : {}), ...(eq ? { eq } : {}) },
      );
      all.push(...page.records);
      cursor = page.next_cursor;
    } while (cursor);
    return all;
  }

  static async get<T extends DbRecord>(table: BlogTable, id: string): Promise<T> {
    const env = await call<RecordEnvelope<T>>(`/tables/${table}/records/${id}/get`, {});
    return env.record;
  }

  /** `fields` nests on the way in; the answer's `record` is flat. */
  static async create<T extends DbRecord>(
    table: BlogTable,
    fields: Record<string, string>,
  ): Promise<T> {
    const env = await call<RecordEnvelope<T>>(`/tables/${table}/records/create`, { fields });
    return env.record;
  }

  /** Owner-only by platform rule — a submitter cannot update their own record. */
  static async update<T extends DbRecord>(
    table: BlogTable,
    id: string,
    fields: Record<string, string>,
  ): Promise<T> {
    const env = await call<RecordEnvelope<T>>(`/tables/${table}/records/${id}/update`, {
      fields,
    });
    return env.record;
  }

  /** Owner-only by platform rule — which is why there is no un-like and why
   *  comment removal is the owner's moderation tool, not the commenter's. */
  static async remove(table: BlogTable, id: string): Promise<void> {
    await call<{ ok: boolean }>(`/tables/${table}/records/${id}/delete`, {});
  }
}
