// The club's whole "backend": a thin client over the platform's managed
// database, simple_db (manual: https://pilely.app/skill/app_management/simple_db).
//
// Flow: page → SimpleDb.<verb>() → window.pilely.fetch (attaches the app
// token, silently re-mints, and on a public app holds an ANONYMOUS
// credential for signed-out visitors) → https://simple-db.<apex>/apps/<app_id>/tables/…
//
// This app is the two-sided shape, and the two tables are mirror images of
// each other — that is the pattern worth copying:
//
//   events   read_group: null + anon_read: true   write_group: empty group
//            → the host publishes, the WHOLE WORLD reads (signed out too)
//   rsvps    read_group: empty group              write_group: null
//            → any signed-in guest writes, ONLY the host reads
//
// Four contract points that are easy to get wrong, all handled here so
// screens never think about them:
//
//  1. WRITES NEST, READS ARE FLAT. You send `{"fields": {"title": "…"}}`
//     but the columns come back at the TOP LEVEL of `record`, beside `id`
//     and the `_`-prefixed server-minted fields — not under `fields`.
//  2. LISTS ARE PAGED, NEWEST FIRST. `records/list` answers at most 100
//     rows plus a `next_cursor`; `listAll` walks the cursor to the end.
//  3. AN RSVP CAN ONLY EVER BE CREATED. Updating or deleting a record is
//     the DB OWNER's alone — a guest cannot edit the row they submitted.
//     So "change my RSVP" is a second `create`, and the host portal keeps
//     the latest row per `_submitter_handle` (lib/rollup.ts).
//  4. EVERY DENIAL IS A UNIFORM 404 — byte-identical to "no such table".
//     A guest listing `rsvps` gets one. Never read a 404 as proof that
//     something is missing, and never as "not signed in": UI gates on
//     `window.pilely.user()` (see the session store).
//
// Columns are typed here, not all-`text`: simple_db supports
// `text | integer | real | boolean | json` and round-trips them as real
// JSON values, so `starts_at_ms` arrives as a number and `canceled` as a
// boolean — no parsing in the screens.

/** Server-minted fields present on every record; you never declare these. */
export interface DbRecord {
  id: string;
  _submitter_handle: string;
  /** Absent for ANONYMOUS readers of an `anon_read` table — a signed-out
   *  visitor reading `events` gets one field less, by design. */
  _submitter_user_id?: string;
  _created_at_ms: number;
  _updated_at_ms: number;
}

// ── The club's two tables (see build_instruction.md for their access) ──

export interface EventRecord extends DbRecord {
  title: string;
  /** Epoch ms of the start — an `integer` column, so it sorts and splits. */
  starts_at_ms: number;
  /** IANA zone the host created it in; every render formats in this zone. */
  tz: string;
  place: string;
  description: string;
  /** simple_blob nanoid of the cover, or "" for the gradient placeholder. */
  cover_blob_id: string;
  /** A `boolean` column. Canceled events keep their history and their
   *  RSVPs; they simply render as canceled. */
  canceled: boolean;
}

export type RsvpStatus = "going" | "cant";

export interface RsvpRecord extends DbRecord {
  /** The `events` record id this answers. */
  event_id: string;
  status: RsvpStatus;
  /** Heads including the sender; always 0 on a `cant` row. */
  party: number;
  /** Optional note to the host; "" when skipped. */
  note: string;
}

export type ClubTable = "events" | "rsvps";

/** What a write sends. simple_db validates each value against the column's
 *  declared type, so the union is exactly the types this app declares. */
export type Fields = Record<string, string | number | boolean>;

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

// Envelopes: create/update → {ok, record}; list → {ok, records, next_cursor};
// delete → {ok, deleted}.
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
    throw new Error('pilely client not loaded or <meta name="pilely-app"> missing');
  }
  return id;
}

/** POST one simple_db route through the platform client and unwrap the
 *  envelope. Every route is POST-to-act; `Accept: application/json`
 *  selects the JSON shape. */
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

/** Static-method namespace over the record routes this app uses. */
export class SimpleDb {
  /**
   * Every row of a table, newest first, walking `next_cursor` to the end.
   *
   * `eq` is the server-side equality filter (`{ column: value }`, ANDed).
   * The screens load each table once and group in memory — one host's
   * events and their RSVPs are small — but the delete cascade uses `eq`
   * where it is load-bearing: it must see EVERY row for that event,
   * including ones written since the page loaded.
   */
  static async listAll<T extends DbRecord>(
    table: ClubTable,
    eq?: Record<string, string>,
  ): Promise<T[]> {
    const out: T[] = [];
    let cursor: string | null = null;
    do {
      const env: ListEnvelope<T> = await call<ListEnvelope<T>>(
        `/tables/${table}/records/list`,
        { limit: 100, ...(cursor ? { cursor } : {}), ...(eq ? { eq } : {}) },
      );
      out.push(...env.records);
      cursor = env.next_cursor;
    } while (cursor);
    return out;
  }

  /** `fields` nests on the way in; the answer's `record` is flat. */
  static async create<T extends DbRecord>(table: ClubTable, fields: Fields): Promise<T> {
    const env = await call<RecordEnvelope<T>>(`/tables/${table}/records/create`, { fields });
    return env.record;
  }

  /** Owner-only, enforced server-side — a guest's update of their own row
   *  answers the uniform 404. Partial: send only the columns that change. */
  static async update<T extends DbRecord>(
    table: ClubTable,
    id: string,
    fields: Fields,
  ): Promise<T> {
    const env = await call<RecordEnvelope<T>>(`/tables/${table}/records/${id}/update`, { fields });
    return env.record;
  }

  /** Owner-only too — which is what lets the host purge an event's RSVPs,
   *  rows other people submitted. Hard delete, no undo. */
  static async remove(table: ClubTable, id: string): Promise<void> {
    await call<{ ok: boolean }>(`/tables/${table}/records/${id}/delete`, {});
  }
}
