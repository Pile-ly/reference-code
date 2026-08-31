import { PilelyError } from "./error.js";
import { client, ready, serviceOrigin } from "./runtime.js";
import type { PilelyService } from "./types.js";

export interface CallOptions {
  service: PilelyService;
  /** Relative to the service origin; begins with "/". */
  path: string;
  /** JSON body. Mutually exclusive with `form`. */
  body?: unknown;
  /** Multipart body — mutually exclusive with `body`. Never set a
   *  content-type alongside this; the browser must write its own boundary. */
  form?: FormData;
}

interface Envelope {
  ok?: boolean;
  code?: string;
  reason?: string;
}

/**
 * The one transport every method in every service package goes through.
 * Never hand-roll a `fetch` next to this — that is how a token reaches the
 * wrong origin, and separately how a blob binds to nothing (see
 * `@pilely/simple-blob`'s README). `call` is also exported as the escape
 * hatch for a route no wrapper covers yet.
 */
export async function call<T>(options: CallOptions): Promise<T> {
  await ready();
  const pilely = client();

  const url = `${serviceOrigin(options.service)}${options.path}`;
  const headers: Record<string, string> = { accept: "application/json" };
  const init: RequestInit = { method: "POST", headers };

  if (options.form) {
    // The browser must write the multipart boundary itself — setting
    // content-type here would strip it.
    init.body = options.form;
  } else {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(options.body ?? {});
  }

  const res = await pilely.fetch(url, init);

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // the bare uniform 404 has no body
  }
  const envelope = json as Envelope | null;

  if (!res.ok || envelope?.ok === false) {
    throw new PilelyError(
      res.status,
      envelope?.code ?? null,
      envelope?.reason ?? `${options.service} answered ${res.status}`,
    );
  }

  return json as T;
}

/**
 * Walks a paged `simple_*` listing route to the end. `nextCursor` is `null`
 * exactly when the page was not full — that is the loop terminator, and
 * the server guarantees it with a fetch-one-extra check. This owns the
 * loop only, not a cursor type: the services use at least five different
 * cursor shapes, so a single cursor type would not fit them.
 *
 * Deleting rows while cursoring is unstable — a keyset cursor over a
 * shrinking set can skip rows.
 */
export async function collectPages<TRow, TCursor>(
  fetchPage: (cursor: TCursor | null) => Promise<{ rows: TRow[]; nextCursor: TCursor | null }>,
): Promise<TRow[]> {
  const all: TRow[] = [];
  let cursor: TCursor | null = null;
  do {
    const page = await fetchPage(cursor);
    all.push(...page.rows);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
}
