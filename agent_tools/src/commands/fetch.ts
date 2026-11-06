// pilely fetch — the one HTTP call every agent makes.
//
//   pilely fetch GET  <url> [--bearer-secret <ref>] [--save-secret <path>=<ref>]...
//   pilely fetch POST <url> [<body>] [--as <app-host>] [--json] [--bearer-secret <ref>] [--save-secret <path>=<ref>]...
//
// Prints the response body and nothing else. Exits 0 on a 2xx response,
// 4 on 4xx, 5 on 5xx, 1 on anything else.
//
// Secrets (`<ref>` is `<app-host>/<NAME>`, see secret_store.ts) never pass
// through the agent:
// - `[[secret:<ref>]]` in the body is filled in here, and only for
//   `simple-env.<apex>` (a JSON body) or `api.stripe.com` (a form body).
// - `--bearer-secret <ref>` is the key a call to `api.stripe.com` is sent
//   with; that host never gets a Pilely token, and no other host takes it.
// - `--save-secret <path>=<ref>` saves the string at that dotted path of a
//   2xx JSON answer to the keychain, and prints the answer with it replaced.
// - Every value used, and anything shaped like a Stripe secret, is printed
//   as `<redacted>`.

import { requireAccountEmail } from '../account.ts';
import type { Context } from '../context.ts';
import { CliError } from '../errors.ts';
import type { CommandResult } from '../errors.ts';
import { isSuccess, parseJsonObject } from '../http.ts';
import { hostOf, pilelyRequest } from '../pilely_request.ts';
import type { PilelyRequest } from '../pilely_request.ts';
import {
  STRIPE_API_HOST,
  fillPlaceholders,
  formatRef,
  hasPlaceholder,
  parseSecretRef,
  redactSecrets,
  requireSecret,
  saveSecret,
} from '../secrets.ts';
import type { SecretRef } from '../secrets.ts';

const USAGE =
  'usage: pilely fetch {GET <url>|POST <url> [<body>] [--as <app-host>] [--json]} [--bearer-secret <app-host>/<NAME>] [--save-secret <path>=<app-host>/<NAME>]...';

export interface FetchArgs {
  request: PilelyRequest;
  bearerSecret?: SecretRef;
  saveSecrets: { path: string[]; ref: SecretRef }[];
}

export async function fetchCommand(ctx: Context, args: string[]): Promise<CommandResult> {
  const { request, bearerSecret, saveSecrets } = parseArgs(args);
  const host = hostOf(request.url);
  const used: string[] = [];

  if (bearerSecret || hasPlaceholder(request.jsonBody)) {
    const email = requireAccountEmail(ctx);
    if (bearerSecret) {
      if (host !== STRIPE_API_HOST) throw new CliError(`--bearer-secret only applies to ${STRIPE_API_HOST}`);
      request.stripeKey = requireSecret(ctx, email, bearerSecret);
      used.push(request.stripeKey);
    }
    if (hasPlaceholder(request.jsonBody)) {
      const encoding = placeholderEncoding(ctx, host);
      const filled = fillPlaceholders(ctx, email, request.jsonBody!, encoding);
      request.jsonBody = filled.text;
      used.push(...filled.used);
    }
  }

  const response = await pilelyRequest(ctx, request);
  let body = response.body;
  let exitCode = exitCodeFor(response.status);
  if (saveSecrets.length > 0 && isSuccess(response.status)) {
    const saved = saveFromAnswer(ctx, body, saveSecrets);
    body = saved.body;
    if (!saved.ok) exitCode = 1;
  }
  return { stdout: redactSecrets(body, used), exitCode };
}

/** A secret is filled in only where it is meant to go. */
function placeholderEncoding(ctx: Context, host: string): 'json' | 'form' {
  if (host === STRIPE_API_HOST) return 'form';
  if (host === `simple-env.${ctx.config.apexHost}`) return 'json';
  throw new CliError(
    `[[secret:...]] is filled in only for simple-env.${ctx.config.apexHost} and ${STRIPE_API_HOST}, not ${host}`,
  );
}

/**
 * Saves each named field of a JSON answer and puts a marker in its place.
 * A missing or non-string field saves nothing for that ref and fails the
 * call, so the agent learns the key was not kept.
 */
function saveFromAnswer(
  ctx: Context,
  body: string,
  saveSecrets: FetchArgs['saveSecrets'],
): { body: string; ok: boolean } {
  const answer = parseJsonObject(body);
  if (!answer) {
    ctx.note('--save-secret needs a JSON answer (add --json); nothing was saved');
    return { body, ok: false };
  }
  const email = requireAccountEmail(ctx);
  let ok = true;
  for (const { path, ref } of saveSecrets) {
    const parent = walk(answer, path.slice(0, -1));
    const key = path.at(-1)!;
    const value = parent?.[key];
    if (typeof value !== 'string' || value === '') {
      ctx.note(`the answer has no text at ${path.join('.')}; ${formatRef(ref)} was not saved`);
      ok = false;
      continue;
    }
    saveSecret(ctx, email, ref, value);
    parent![key] = `<saved to keychain: ${formatRef(ref)}>`;
  }
  return { body: JSON.stringify(answer), ok };
}

function walk(value: unknown, path: string[]): Record<string, unknown> | undefined {
  let current = value;
  for (const segment of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current !== null && typeof current === 'object' ? (current as Record<string, unknown>) : undefined;
}

export function parseArgs(args: string[]): FetchArgs {
  const [method, url, ...rest] = args;
  if (!method || !url) throw new CliError(USAGE);
  if (method !== 'GET' && method !== 'POST') throw new CliError(USAGE);

  const request: PilelyRequest = { method, url };
  const parsed: FetchArgs = { request, saveSecrets: [] };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === '--bearer-secret') {
      const ref = rest[++i];
      if (!ref || parsed.bearerSecret) throw new CliError(USAGE);
      parsed.bearerSecret = parseSecretRef(ref);
    } else if (arg === '--save-secret') {
      const spec = rest[++i];
      const eq = spec?.indexOf('=') ?? -1;
      if (!spec || eq <= 0) throw new CliError(USAGE);
      const path = spec.slice(0, eq).split('.');
      if (path.some((segment) => segment === '')) throw new CliError(`not a field path: ${spec.slice(0, eq)}`);
      parsed.saveSecrets.push({ path, ref: parseSecretRef(spec.slice(eq + 1)) });
    } else if (method === 'GET') {
      throw new CliError(USAGE);
    } else if (arg === '--as') {
      const host = rest[++i];
      if (!host) throw new CliError(USAGE);
      request.asAppHost = host;
    } else if (arg === '--json') {
      request.wantJson = true;
    } else if (request.jsonBody === undefined) {
      request.jsonBody = arg;
    } else {
      throw new CliError(USAGE);
    }
  }
  return parsed;
}

function exitCodeFor(status: number): number {
  if (status >= 200 && status < 300) return 0;
  if (status >= 400 && status < 500) return 4;
  if (status >= 500 && status < 600) return 5;
  return 1;
}
