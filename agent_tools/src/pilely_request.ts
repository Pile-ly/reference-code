// The one authenticated call every tool makes: picks the right token by
// host and sends it.
//
// Apex host (pilely.app): the login token; a GET goes to the URL as given
// (`GET /` redirects to `/README.md`, which is followed), and a POST asks
// for JSON.
//
// Any other host: an app token for that host. `asAppHost` mints for that
// app instead of for the target host itself, so a simple_* service can be
// called on an app's behalf. `wantJson` asks a non-apex host for JSON
// instead of markdown.
//
// The login token is never sent off the apex host. That is not a runtime
// check to bypass — the non-apex branch below never reads it at all.
//
// api.stripe.com: never a Pilely token. The call carries the app's own
// Stripe key (`stripeKey`, read from the keychain by the fetch command) and
// a form body, the way Stripe's API takes it.

import { requireAccountEmail, requireLoginToken } from './account.ts';
import { appTokenFor } from './app_token.ts';
import type { Context } from './context.ts';
import { CliError } from './errors.ts';
import type { HttpResponse } from './http.ts';
import { STRIPE_API_HOST } from './secrets.ts';

export interface PilelyRequest {
  method: 'GET' | 'POST';
  url: string;
  jsonBody?: string;
  asAppHost?: string;
  wantJson?: boolean;
  /** The Stripe key a call to api.stripe.com is sent with. */
  stripeKey?: string;
}

export async function pilelyRequest(ctx: Context, request: PilelyRequest): Promise<HttpResponse> {
  const email = requireAccountEmail(ctx);
  const host = hostOf(request.url);
  const headers: Record<string, string> = {};

  if (host === STRIPE_API_HOST) return stripeRequest(ctx, request);
  if (request.stripeKey) throw new CliError(`a Stripe key is only sent to ${STRIPE_API_HOST}`);

  if (host === ctx.config.apexHost) {
    if (request.asAppHost) throw new CliError('--as only applies off the apex host');
    headers.Authorization = `Bearer ${requireLoginToken(ctx, email)}`;
    ctx.note(`sending login token to ${host}`);
    if (request.method === 'POST') headers.Accept = 'application/json';
  } else {
    const mintTarget = request.asAppHost ?? host;
    headers.Authorization = `Bearer ${await appTokenFor(ctx, email, mintTarget)}`;
    ctx.note(`sending app token minted for ${mintTarget} to ${host}`);
    if (request.wantJson) headers.Accept = 'application/json';
  }

  if (request.method === 'GET') {
    return ctx.http({ method: 'GET', url: request.url, headers });
  }
  headers['Content-Type'] = 'application/json';
  return ctx.http({ method: 'POST', url: request.url, headers, body: request.jsonBody || '{}' });
}

async function stripeRequest(ctx: Context, request: PilelyRequest): Promise<HttpResponse> {
  if (!request.stripeKey) throw new CliError(`${STRIPE_API_HOST} needs --bearer-secret <app-host>/<NAME>`);
  if (request.asAppHost || request.wantJson) throw new CliError(`--as and --json do not apply to ${STRIPE_API_HOST}`);
  const headers: Record<string, string> = { Authorization: `Bearer ${request.stripeKey}` };
  ctx.note(`sending a saved Stripe key to ${STRIPE_API_HOST}`);
  if (request.method === 'GET') return ctx.http({ method: 'GET', url: request.url, headers });
  headers['Content-Type'] = 'application/x-www-form-urlencoded';
  return ctx.http({ method: 'POST', url: request.url, headers, body: request.jsonBody ?? '' });
}

export function hostOf(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CliError(`not a URL: ${url}`);
  }
  // Every request here carries a token, so it never travels in clear text.
  if (parsed.protocol !== 'https:') throw new CliError(`refusing a non-https URL: ${url}`);
  return parsed.hostname;
}
