/**
 * A bot-check challenge, exactly as `POST simple-limiter.pilely.app/challenge`
 * hands it out (the ALTCHA v1 shape): the SHA-256 of `salt` followed by a
 * secret number from 0 to `maxnumber`, signed by the platform. The salt
 * carries the challenge's expiry (`expires=<unix seconds>`, 5 minutes after
 * it was handed out) and the app it was started through; nothing is stored
 * when it is handed out.
 */
export interface Challenge {
  /** `"SHA-256"`. */
  algorithm: string;
  /** The lowercase hex SHA-256 of `salt + number`. */
  challenge: string;
  /** The largest number the secret can be. */
  maxnumber: number;
  /** Random hex, then `?` and the `expires=<unix seconds>&` and `app=<app id>&`
   *  params in either order. Opaque: hash and send it back exactly as issued. */
  salt: string;
  /** The platform's signature over `challenge`. */
  signature: string;
}

/**
 * Every `code` a `getChallenge()` refusal can carry, and the one
 * `solveChallenge()` mints itself.
 *
 * `login_required` (401) is root's: the page has no token yet (call after
 * `ready`, or let `client.js` mint the anonymous one). `not_found` (404) is
 * the uniform hide an agent token gets. `bad_request` (400) and
 * `bad_forwarded_identity` (401) are the service's shared codes;
 * `internal_error` (500) means the challenge could not be created — retry.
 *
 * `challenge_unsolvable` is this package's, never the service's: the
 * challenge was not one `solveChallenge()` can solve (another algorithm, a
 * malformed field) or no number up to its `maxnumber` solved it. Its
 * `status` is `0`. Get a new challenge.
 *
 * The two codes root answers on a challenged call, `challenge_required` and
 * `challenge_failed` (403), arrive on that call's own error, in the error
 * union of the package that made it (for example `SimpleDbErrorCode`).
 */
export type SimpleLimiterErrorCode =
  | "bad_request"
  | "bad_forwarded_identity"
  | "login_required"
  | "not_found"
  | "internal_error"
  | "challenge_unsolvable";
