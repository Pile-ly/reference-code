// Agent ID tokens: the credential an agent carries to act in a workspace.
// Only the agent's owner can issue one, they live about an hour, and the
// issue route is the only place the encoded token is ever returned — so
// the tools cache it in the keychain per agent handle and re-issue with
// the user's own login when it is missing or about to expire.

import type { Context } from './context.ts';
import { CliError } from './errors.ts';
import { isSuccess, parseJsonObject, stringField } from './http.ts';
import { AGENT_TOKEN_SERVICE } from './keychain.ts';
import { pilelyRequest } from './pilely_request.ts';

const EXPIRY_SKEW_MS = 60_000;

export async function agentTokenFor(ctx: Context, handle: string, appId: string): Promise<string> {
  return cachedAgentToken(ctx, handle) ?? (await issueAgentToken(ctx, handle, appId));
}

function cachedAgentToken(ctx: Context, handle: string): string | undefined {
  const raw = ctx.keychain.get(AGENT_TOKEN_SERVICE, handle);
  if (!raw) return undefined;
  const separator = raw.indexOf(':');
  if (separator <= 0) return undefined;
  const expiry = Number(raw.slice(0, separator));
  const token = raw.slice(separator + 1);
  if (!Number.isFinite(expiry) || token === '') return undefined;
  return expiry - EXPIRY_SKEW_MS > ctx.now().getTime() ? token : undefined;
}

export async function issueAgentToken(ctx: Context, handle: string, appId: string): Promise<string> {
  const response = await pilelyRequest(ctx, {
    method: 'POST',
    url: `${ctx.config.agentBaseUrl}/@${handle}/issue_id_token`,
    jsonBody: JSON.stringify({ audience: appId, name: 'pilely workspace' }),
    wantJson: true,
  });
  if (!isSuccess(response.status)) {
    throw new CliError(`unable to issue an ID token for agent ${handle} (http ${response.status}): ${response.body}`);
  }
  const issued = parseJsonObject(response.body)?.id_token;
  const fields = issued !== null && typeof issued === 'object' ? (issued as Record<string, unknown>) : undefined;
  const token = stringField(fields, 'token');
  const expiresAt = Date.parse(stringField(fields, 'expires_at') ?? '');
  if (!token || !Number.isFinite(expiresAt)) {
    throw new CliError(`issue_id_token response for agent ${handle} carried no token`);
  }
  ctx.keychain.set(AGENT_TOKEN_SERVICE, handle, `${expiresAt}:${token}`);
  return token;
}

export function forgetAgentToken(ctx: Context, handle: string): void {
  ctx.keychain.delete(AGENT_TOKEN_SERVICE, handle);
}

/** The agent's immutable UUID: the `sub` claim of its ID token. */
export function agentIdFromToken(token: string): string {
  const payload = token.split('.')[1];
  if (payload) {
    const claims = parseJsonObject(Buffer.from(payload, 'base64url').toString('utf8'));
    const sub = stringField(claims, 'sub');
    if (sub) return sub;
  }
  throw new CliError('the agent ID token carries no agent id');
}
