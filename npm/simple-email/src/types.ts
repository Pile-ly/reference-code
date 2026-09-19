/** Every `code` the simple_email service can put in a `{ok:false, code, reason}`
 *  refusal. Exhaustive as of the 2026-09 review, checked against the service's
 *  `response_json.rs` and `render.rs`.
 *
 *  This is the union that most earns its keep: `daily_cap_exceeded` and
 *  `rate_limited` BOTH answer 429, so a consumer cannot tell a burst limit
 *  (retry shortly) from the per-app daily send cap (retry tomorrow) by status
 *  alone — only by matching this code. */
export type SimpleEmailErrorCode =
  | "unauthenticated"
  | "bad_forwarded_identity"
  | "bad_request"
  | "not_found"
  | "account_exists"
  | "account_limit_reached"
  | "template_limit_reached"
  /** 429, same status as `rate_limited` — the per-app UTC-day send cap. */
  | "daily_cap_exceeded"
  | "phone_verification_required"
  | "phone_verification_unavailable"
  | "out_of_traffic_credits"
  | "rate_limited"
  | "internal";

/** `address` is derived at read time, never stored, and `null` when the
 *  app it names is gone. */
export interface Account {
  app_id: string;
  address: string | null;
  display_name: string | null;
  /** `null` means owner-only — the opposite polarity from simple_db's
   *  `read_group`/`write_group`, where `null` means everyone. */
  send_group: string | null;
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
