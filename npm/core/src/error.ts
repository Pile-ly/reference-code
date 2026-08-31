/**
 * The one error type every package in this scope throws. It normalizes both
 * denial shapes a `simple_*` service can answer with: a bare, bodiless 404
 * (the uniform "not found or not allowed" the edge returns with no
 * envelope) and an `{ok: false, code, reason}` envelope from the service
 * itself. It carries nothing else — no raw response body, no upstream
 * detail — the platform rule that internals never surface applies to the
 * client as much as the server.
 *
 * Gate UI on `user() === null`, never on a status: a denied write on a
 * public app comes back as a uniform 404, not a 401. Denied and
 * does-not-exist are byte-identical by design, so never split this into a
 * `NotFoundError` / `DeniedError` pair and never retry on one status and not
 * the other — either hands back the oracle the platform closed.
 */
export class PilelyError extends Error {
  override name = "PilelyError";

  constructor(
    readonly status: number,
    readonly code: string | null,
    readonly reason: string,
  ) {
    super(reason);
  }
}
