// The one authenticated call every tool makes: picks the right token by
// host and sends it.
//
// Apex host (pilely.app): the login token; a GET path without `.md` gets
// `.md` appended, and a POST asks for JSON.
//
// Any other host: an app token for that host. `asAppHost` mints for that
// app instead of for the target host itself, so a simple_* service can be
// called on an app's behalf. `wantJson` asks a non-apex host for JSON
// instead of markdown.
//
// The login token is never sent off the apex host. That is not a runtime
// check to bypass — the non-apex branch below never reads it at all.

import { requireAccountEmail, requireLoginToken } from './account.ts';
import { appTokenFor } from './app_token.ts';
import type { Context } from './context.ts';
import { CliError } from './errors.ts';
import type { HttpResponse } from './http.ts';

export interface PilelyRequest {
  method: 'GET' | 'POST';
  url: string;
  jsonBody?: string;
  asAppHost?: string;
  wantJson?: boolean;
}

export async function pilelyRequest(ctx: Context, request: PilelyRequest): Promise<HttpResponse> {
  const email = requireAccountEmail(ctx);
  const host = hostOf(request.url);
  const headers: Record<string, string> = {};
  let url = request.url;

  if (host === ctx.config.apexHost) {
    if (request.asAppHost) throw new CliError('--as only applies off the apex host');
    headers.Authorization = `Bearer ${requireLoginToken(ctx, email)}`;
    ctx.note(`sending login token to ${host}`);
    if (request.method === 'GET') {
      url = withMarkdownSuffix(url);
    } else {
      headers.Accept = 'application/json';
    }
  } else {
    const mintTarget = request.asAppHost ?? host;
    headers.Authorization = `Bearer ${await appTokenFor(ctx, email, mintTarget)}`;
    ctx.note(`sending app token minted for ${mintTarget} to ${host}`);
    if (request.wantJson) headers.Accept = 'application/json';
  }

  if (request.method === 'GET') {
    return ctx.http({ method: 'GET', url, headers });
  }
  headers['Content-Type'] = 'application/json';
  return ctx.http({ method: 'POST', url, headers, body: request.jsonBody || '{}' });
}

function hostOf(url: string): string {
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

/** Appends `.md` to a path that lacks it, before any query string. */
export function withMarkdownSuffix(url: string): string {
  const parsed = new URL(url);
  if (!parsed.pathname.endsWith('.md')) {
    parsed.pathname = parsed.pathname === '/' ? '/index.md' : `${parsed.pathname}.md`;
  }
  return parsed.toString();
}
