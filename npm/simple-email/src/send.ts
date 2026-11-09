// `send` — the freestyle send, `POST /accounts/{app_id}/send`, for an app's
// BACKEND only. The service admits exactly one caller on that route: the
// account's app's own backend, calling with its backend token (`app:<A>` on
// app A). A page, a signed-in user, the owner and every other app get the
// uniform 404, so this function has no browser half: no `window.pilely`, no
// `client.js`, no React. It takes the backend token and the app id
// explicitly and makes one plain `fetch` with the token as bearer.
//
// This module imports nothing at runtime — not `@pilely/core`, not React —
// so a server imports it from the `@pilely/simple-email/send` subpath
// without any of the package's peers loaded. It is also re-exported from the
// main entry. Mock mode does not reach it: it calls the global `fetch`
// directly.

import type { SimpleEmailErrorCode } from "./types.js";

/** Where the service answers. A testing-tier lane passes its own origin. */
export const SIMPLE_EMAIL_ORIGIN = "https://simple-email.pilely.app";

/** `to` holds 1 to 50 addresses. */
export type SendContent =
  | { template_id: string; variables?: Record<string, string> }
  | { subject: string; html: string };

/**
 * Optional on both shapes: 1–128 characters of `[A-Za-z0-9._:-]`, held per
 * app for 24 hours from its first use. A repeat with the same key and the
 * same body answers the first send's `send_id` with `replayed: true` and
 * sends and bills nothing; the same key with another body is
 * `409 idempotency_key_reused`. Pick keys stable per logical email
 * (`digest:<user id>:<YYYY-MM-DD>`, `confirm:<row id>`) — a new key per
 * attempt defeats the protection.
 */
export interface SendKey {
  idempotency_key?: string;
}

/** A freestyle send: to the addresses in `to`, template or inline content. */
export type SendInput = { to: string[] } & SendContent & SendKey;

/** `replayed` is `true` when the answer is an earlier keyed send's (nothing
 *  new was sent), `false` for a new send — and always `false` without an
 *  `idempotency_key`. Duplicate addresses collapse, so `recipient_count`
 *  can be lower than `to.length`. */
export interface SendResult {
  send_id: string;
  recipient_count: number;
  replayed: boolean;
}

export interface SendOptions {
  /** The account's app — the app whose backend this is. */
  appId: string;
  /** The backend's own `PILELY_BACKEND_TOKEN`. Sent only as the bearer,
   *  only to `origin`. */
  backendToken: string;
  /** Defaults to `https://simple-email.pilely.app`. */
  origin?: string;
}

/** A refused `send`. `code` is `null` for a bodiless answer — an oversize
 *  body refused before any handler runs, an unknown path — and on a missing
 *  `appId` or `backendToken` (`status` 0, nothing was sent). Never carries
 *  the token. */
export class SendError extends Error {
  override name = "SendError";

  constructor(
    readonly status: number,
    readonly code: SimpleEmailErrorCode | null,
    readonly reason: string,
  ) {
    super(reason);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Sends one message from the app's account to every address in `to`:
 * `POST <origin>/accounts/<appId>/send` with the backend token as bearer.
 * Resolves to the service's answer; throws `SendError` on any refusal — a
 * caller that is not this app's backend, an unknown account or template, or
 * the owner out of balance (all one 404), a bad body (400), an
 * `idempotency_key` conflict (409), the app's 500-recipient UTC-day
 * freestyle cap (`429 daily_cap_exceeded`).
 *
 * ```ts
 * import { send } from "@pilely/simple-email/send";
 *
 * await send(
 *   { to: [row.email], template_id: WELCOME, variables: { name: row.name }, idempotency_key: `welcome:${row.id}` },
 *   { appId: process.env.APP_ID!, backendToken: process.env.PILELY_BACKEND_TOKEN! },
 * );
 * ```
 */
export async function send(input: SendInput, options: SendOptions): Promise<SendResult> {
  const { appId, backendToken } = options;
  if (!appId) throw new SendError(0, null, "send needs an appId (the account's app uuid)");
  if (!backendToken) throw new SendError(0, null, "send needs a backendToken (PILELY_BACKEND_TOKEN is not set)");
  const origin = (options.origin ?? SIMPLE_EMAIL_ORIGIN).replace(/\/+$/, "");

  const { to, idempotency_key } = input;
  const body =
    "template_id" in input
      ? { to, template_id: input.template_id, variables: input.variables, idempotency_key }
      : { to, subject: input.subject, html: input.html, idempotency_key };

  const res = await fetch(`${origin}/accounts/${encodeURIComponent(appId)}/send`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${backendToken}`,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // a bare answer has no body
  }

  const envelope = isObject(json) ? json : {};
  if (res.status !== 200 || envelope.ok === false) {
    const code = typeof envelope.code === "string" ? (envelope.code as SimpleEmailErrorCode) : null;
    const reason = typeof envelope.reason === "string" ? envelope.reason : `simple-email answered ${res.status}`;
    throw new SendError(res.status, code, reason);
  }
  if (typeof envelope.send_id !== "string") {
    throw new SendError(res.status, null, "simple-email answered 200 without a send_id");
  }
  return {
    send_id: envelope.send_id,
    recipient_count: Number(envelope.recipient_count),
    replayed: envelope.replayed === true,
  };
}
