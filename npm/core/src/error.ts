/** The fields a refusal envelope may carry beyond `code` and `reason`, each
 *  naming something the caller already owns: `simple_db`'s `409 key_exists`
 *  names the caller's existing row (`id`), and its `409 version_conflict`
 *  names the row's current `_version` (`current_version` on the wire). */
export interface PilelyErrorDetails {
  id?: string;
  currentVersion?: number;
}

/**
 * The one error type every package in this scope throws. It normalizes both
 * denial shapes a `simple_*` service can answer with: a bare, bodiless 404
 * (the uniform "not found or not allowed" the edge returns with no
 * envelope) and an `{ok: false, code, reason}` envelope from the service
 * itself. Beyond `status`, `code` and `reason` it carries only the two
 * envelope fields in `PilelyErrorDetails`, when a refusal sends them — no
 * raw response body, no upstream detail — the platform rule that internals
 * never surface applies to the client as much as the server.
 *
 * Gate UI on `user() === null`, never on a status: a denied write on a
 * public app comes back as a uniform 404, not a 401. Denied and
 * does-not-exist are byte-identical by design, so never split this into a
 * `NotFoundError` / `DeniedError` pair and never retry on one status and not
 * the other — either hands back the oracle the platform closed.
 */
export class PilelyError extends Error {
  override name = "PilelyError";

  /** The existing row a `409 key_exists` names; otherwise `undefined`. */
  readonly id: string | undefined;
  /** The row's `_version` a `409 version_conflict` reports; otherwise
   *  `undefined`. */
  readonly currentVersion: number | undefined;

  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly reason: string,
    details: PilelyErrorDetails = {},
  ) {
    super(reason);
    this.id = details.id;
    this.currentVersion = details.currentVersion;
  }
}
