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
  /** Not updatable through `updateTemplate` — only `subject` and `html` are. */
  name: string;
  subject: string;
  created_time_stamp: number;
  updated_time_stamp: number;
}

/** What `templates/{t}/info` answers with — `TemplateMeta` plus the body. */
export interface Template extends TemplateMeta {
  html: string;
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
