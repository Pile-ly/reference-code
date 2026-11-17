/** Every `code` the simple_email service can put in a `{ok:false, code, reason}`
 *  refusal, including the two `idempotency_key_*` conflicts, checked
 *  against the service's `response_json.rs` and `render.rs`.
 *
 *  Status alone does not say what to do: `daily_cap_exceeded` and
 *  `rate_limited` BOTH answer 429, so a consumer cannot tell a spent UTC-day
 *  allowance (retry tomorrow) from a limiter policy (retry after
 *  `Retry-After`) by status alone — only by matching this code. */
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
  /** 429 — a per-app UTC-day cap: the daily send cap on a template send,
   *  the 500-recipient freestyle cap on `send()`. */
  | "daily_cap_exceeded"
  | "out_of_traffic_credits"
  /** 429 — over a `@simple_limiter` policy the app's owner set on this
   *  app's template sends; root answers it with a `Retry-After` header. */
  | "rate_limited"
  /** 403 — root's challenge check: a challenge policy the app's owner set
   *  on this route (for example the template send,
   *  `POST /accounts/{app_id}/templates/{template_id}/send`) matches the
   *  call, and it carried no `challenge`. Nothing was sent. */
  | "challenge_required"
  /** 403 — root's challenge check refused the `challenge` sent: malformed,
   *  wrong, expired, started through another app, or already used. Get and
   *  solve a new one (`@pilely/simple-limiter`) and send the call again. */
  | "challenge_failed"
  | "internal";

/** `address` is derived at read time, never stored, and `null` when the
 *  app it names is gone. */
export interface Account {
  app_id: string;
  address: string | null;
  display_name: string | null;
  /** The address recipients' replies go to: every send from the account
   *  carries it as its `Reply-To`. `null` means none — replies go nowhere. */
  reply_to: string | null;
  created_time_stamp: number;
}

/** `daily_cap`'s three siblings are nullable and sit BESIDE `account`, not
 *  inside it — the whole reason an app calls `accountInfo`. */
export interface AccountInfoEnvelope {
  account: Account;
  daily_cap: number;
  sent_today: number | null;
  credit_blocked: boolean | null;
}

/** What `templates/create`, `templates/update` and `templates/list` answer
 *  with — no `html`. */
export interface TemplateMeta {
  template_id: string;
  /** Not updatable through `updateTemplate`. `null` when the template was
   *  created without one: the service accepts a nameless template and
   *  returns the name back as `null`. */
  name: string | null;
  subject: string;
  /** The ONE address every template send of this template goes to. The
   *  owner reads it here; no template-send answer ever carries it. */
  recipient: string;
  /** Who may make a template send of it: an owner group or one of the two
   *  platform-wide groups. `null` is empty — nobody may. */
  send_group: string | null;
  /** An owner group whose members are refused whatever `send_group` says.
   *  `null` is empty — nobody is refused. */
  deny_group: string | null;
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

export interface AccountCursor {
  after_created_time_stamp: number;
  after_app_id: string;
}

export interface TemplateCursor {
  after_created_time_stamp: number;
  after_template_id: string;
}
