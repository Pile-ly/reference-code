/** What a policy's counter is bucketed by. `all` is one shared counter for
 *  the whole route; `user` never counts an anonymous caller (pair it with
 *  an `ip` policy to cover those); `ip` never counts a caller with no
 *  client IP. */
export type PolicyKey = "user" | "ip" | "all";

/** v0 accepts exactly one method per policy. */
export type PolicyMethod = "GET" | "POST";

export interface FixedWindowStrategy {
  type: "fixed_window";
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds — one of 1, 10, 60, 3600, 86400. */
  window_secs: number;
}

export interface TokenBucketStrategy {
  type: "token_bucket";
  /** Steady-state refill rate. */
  rate_per_sec: number;
  /** Bucket capacity — the largest burst above the steady rate. */
  burst: number;
}

/** A policy carries exactly one of these two strategies. */
export type PolicyStrategy = FixedWindowStrategy | TokenBucketStrategy;

/** The fields a caller supplies to `createPolicy` — everything about a
 *  policy except its identity and timestamps, which the server assigns. */
export interface PolicyInput {
  /** Label only, <= 120 chars. */
  name: string;
  /** `<label>.pilely.app` or `simple-db.pilely.app` — every other host is
   *  400 `unsupported_host`. */
  host: string;
  method: PolicyMethod;
  /** Absolute path matched against the pile-local path root forwards.
   *  `*` matches one segment, `**` matches the rest. */
  path: string;
  key: PolicyKey;
  strategy: PolicyStrategy;
}

/** A policy as the server returns it. `id` is the 8-character public id —
 *  the only identity this client ever sees; the server's internal uuid
 *  never leaves the service. A policy is immutable once created: there is
 *  no update, only `disablePolicy`. */
export interface Policy extends PolicyInput {
  id: string;
  created_at: number;
  /** `null` while active; set once, by `disablePolicy`, and never cleared —
   *  a disabled policy is kept forever as the audit record. */
  disabled_at: number | null;
}

/** `listPolicies`/`listAllPolicies`'s keyset cursor — pass the whole
 *  object back as the next page's options. */
export interface PolicyCursor {
  after_created_at: number;
  after_id: string;
}
