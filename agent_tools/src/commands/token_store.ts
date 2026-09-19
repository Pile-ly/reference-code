// pilely token_store — the login flow.
//
//   pilely token_store send-email-code <email>
//   pilely token_store verify-email-code <email> <code>
//   pilely token_store status
//
// The login token never leaves this tool in cleartext: verify-email-code
// writes it straight to the keychain and never prints it, and no command
// here reads it back out for display.

import { readAccountEmail, writeAccountEmail } from '../account.ts';
import type { Context } from '../context.ts';
import { CliError, failed, ok } from '../errors.ts';
import type { CommandResult } from '../errors.ts';
import { isSuccess, parseJsonObject, stringField } from '../http.ts';
import { LOGIN_SERVICE } from '../keychain.ts';

const USAGE =
  'usage: pilely token_store {send-email-code <email>|verify-email-code <email> <code>|status}';

export async function tokenStoreCommand(ctx: Context, args: string[]): Promise<CommandResult> {
  const [command, ...rest] = args;
  switch (command) {
    case 'send-email-code':
      if (rest.length !== 1) throw new CliError('usage: pilely token_store send-email-code <email>');
      return sendEmailCode(ctx, rest[0]!);
    case 'verify-email-code':
      if (rest.length !== 2) throw new CliError('usage: pilely token_store verify-email-code <email> <code>');
      return verifyEmailCode(ctx, rest[0]!, rest[1]!);
    case 'status':
      if (rest.length !== 0) throw new CliError('usage: pilely token_store status');
      return status(ctx);
    default:
      throw new CliError(USAGE);
  }
}

function requireEmail(email: string): void {
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new CliError(`not an email: ${email}`);
}

async function sendEmailCode(ctx: Context, email: string): Promise<CommandResult> {
  requireEmail(email);
  const response = await ctx.http({
    method: 'POST',
    url: `${ctx.config.apexBaseUrl}/~/login`,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (isSuccess(response.status)) return ok('ok\n');
  const code = stringField(parseJsonObject(response.body), 'code') ?? 'unknown_error';
  return failed(`${code}\n`);
}

async function verifyEmailCode(ctx: Context, email: string, code: string): Promise<CommandResult> {
  requireEmail(email);
  // Content-Type stays application/json — the request body shape never
  // changes. It is the Accept header that must NOT ask for JSON: the
  // markdown body is the only one that embeds the JWT.
  const response = await ctx.http({
    method: 'POST',
    url: `${ctx.config.apexBaseUrl}/~/login/verify_auth_code`,
    headers: { 'Content-Type': 'application/json', Accept: 'text/plain' },
    body: JSON.stringify({ email, auth_code: code }),
  });
  if (!isSuccess(response.status)) return failed(`${failureCodeForStatus(response.status)}\n`);

  const token = extractJwt(response.body);
  if (!token) throw new CliError('verify succeeded but no token was found in the response');
  ctx.keychain.set(LOGIN_SERVICE, email, token);
  writeAccountEmail(ctx, email);
  return ok(`${await fetchHandle(ctx, token)}\n`);
}

// The markdown response carries no machine-readable failure code (unlike
// the JSON twin), so a failed verify is classified from the HTTP status
// instead of parsed out of the prose.
function failureCodeForStatus(status: number): string {
  if (status === 400) return 'bad_request';
  if (status === 401) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  if (status >= 500 && status < 600) return 'internal_error';
  return `http_${status}`;
}

/**
 * The JWT sits inside the one fenced code block that follows the "Your
 * auth JWT token" line. The JSON body deliberately never carries it, so
 * this is the only place the token can come from.
 */
export function extractJwt(markdown: string): string | undefined {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => line.includes('Your auth JWT token'));
  if (start < 0) return undefined;
  const fence = lines.findIndex((line, i) => i > start && line.trim() === '```');
  if (fence < 0) return undefined;
  const token = lines[fence + 1]?.trim();
  return token && token !== '```' ? token : undefined;
}

async function whoAmI(ctx: Context, token: string) {
  return ctx.http({
    method: 'POST',
    url: `${ctx.config.apexBaseUrl}/~/me`,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: '',
  });
}

async function fetchHandle(ctx: Context, token: string): Promise<string> {
  const response = await whoAmI(ctx, token);
  if (!isSuccess(response.status)) {
    throw new CliError(`/~/me rejected the freshly stored token (http ${response.status})`);
  }
  const handle = stringField(parseJsonObject(response.body), 'user_handle');
  if (!handle) throw new CliError('/~/me answered without a user_handle');
  return handle;
}

async function status(ctx: Context): Promise<CommandResult> {
  const email = readAccountEmail(ctx);
  if (!email) return failed('no account stored\n');
  const token = ctx.keychain.get(LOGIN_SERVICE, email);
  if (!token) return failed(`${email}: no token stored\n`);
  const response = await whoAmI(ctx, token);
  return isSuccess(response.status)
    ? ok(`${email}: valid\n`)
    : failed(`${email}: invalid (http ${response.status})\n`);
}
