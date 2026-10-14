/** Every `code` the simple_email service can put in a `{ok:false, code, reason}`
 *  refusal, including the two `idempotency_key_*` conflicts, checked
 *  against the service's `response_json.rs` and `render.rs`.
 *
 *  This is the union that most earns its keep: `out_of_traffic_credits` and
 *  `phone_verification_unavailable` BOTH answer 503, so a consumer cannot tell
 *  a used-up owner balance (the owner must top up) from a transient outage
 *  (retry shortly) by status alone — only by matching this code. */
export type SimpleEmailErrorCode =
  | "unauthenticated"
  | "bad_forwarded_identity"
  | "bad_request"
  | "not_found"
  | "account_exists"
  | "account_limit_reached"
  | "template_limit_reached"
  /** 409 — this `idempotency_key` already belongs to a different request
   *  (another body or another caller) on this app in the last 24 hours;
   *  nothing was sent. Use a new key for a different email. */
  | "idempotency_key_reused"
  /** 409 — an earlier request with this `idempotency_key` is still being
   *  handed to the provider; retry in a few seconds. */
  | "idempotency_key_in_progress"
  /** 429 — the per-app UTC-day send cap. */
  | "daily_cap_exceeded"
  | "phone_verification_required"
  | "phone_verification_unavailable"
  | "out_of_traffic_credits"
  /** 429 — over a `@simple_limiter` policy the app's owner set on this
   *  app's sends; root answers it with a `Retry-After` header. */
  | "rate_limited"
  | "internal";

/** Who besides the owner may make account sends (`to_account`):
 *  `"send_group"` (the default) keeps them to the owner and the send group's
 *  members; `"app_users"` also lets every signed-in user arriving through the
 *  account's own app send a template to their own or the owner's account
 *  email. It never opens raw sends (`to`). */
export type AccountSenders = "send_group" | "app_users";

/** The recipient of an account send, resolved by the service: the caller's
 *  own Pilely account email (`"self"`) or the account owner's (`"owner"`).
 *  The caller never supplies or sees the address. */
export type ToAccount = "self" | "owner";

/** `address` is derived at read time, never stored, and `null` when the
 *  app it names is gone. */
export interface Account {
  app_id: string;
  address: string | null;
  display_name: string | null;
  /** `null` means owner-only — the opposite polarity from simple_db's
   *  `read_group`/`write_group`, where `null` means everyone. */
  send_group: string | null;
  account_senders: AccountSenders;
  created_time_stamp: number;
}

/** `daily_cap`'s three siblings are nullable and sit BESIDE `account`, not
 *  inside it — the whole reason an app calls `accountInfo`. */
export interface AccountInfoEnvelope {
  account: Account;
  daily_cap: number;
  sent_today: number | null;
  credit_blocked: boolean | null;
  phone_verified: boolean | null;
}

/** What `templates/create` and `templates/update` answer with — no `html`. */
export interface TemplateMeta {
  template_id: string;
  /** Not updatable through `updateTemplate` — only `subject` and `html` are.
   *  `null` when the template was created without one: the service accepts a
   *  nameless template and returns the name back as `null`. */
  name: string | null;
  subject: string;
  created_time_stamp: number;
  updated_time_stamp: number;
}

/** What `templates/{t}/info` answers with — `TemplateMeta` plus the body.
 *
 *  `html` is OPTIONAL, not nullable: when the R2 object behind the template is
 *  missing (the compensated-create residue the service keeps visible so an
 *  owner can spot it) or its body is not valid UTF-8, the service omits the key
 *  entirely rather than sending `null`. Test with `"html" in template` or a
 *  plain falsy check — never assume the body is there. */
export interface Template extends TemplateMeta {
  html?: string;
}

/** One send-log row. An account send's row carries its `to_account`: for
 *  `"self"`, `recipients` is `[]` and `recipient_count` is `1` — the owner
 *  never sees a user's account email through this service; for `"owner"`,
 *  `recipients` holds the owner's own address. */
export interface SendRow {
  send_id: string;
  requester_user_id: string;
  via_app: boolean;
  kind: string;
  template_id: string | null;
  subject: string;
  recipients: unknown;
  recipient_count: number;
  outcome: string;
  outcome_reason: string | null;
  /** `null` for a raw send. */
  to_account: ToAccount | null;
  /** The caller's `idempotency_key`, or `null` when the send had none. */
  idempotency_key: string | null;
  fired_at: number;
}

export interface SendCursor {
  after_created_time_stamp: number;
  after_send_id: string;
}

export interface AccountCursor {
  after_created_time_stamp: number;
  after_app_id: string;
}

export interface TemplateCursor {
  after_created_time_stamp: number;
  after_template_id: string;
}
