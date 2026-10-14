// App tokens: the credential for every host other than the apex. Cached
// in the keychain per (email, app host) and re-minted at the apex when the
// cache is empty or about to expire.

import { requireLoginToken } from './account.ts';
import type { Context } from './context.ts';
import { CliError } from './errors.ts';
import { isSuccess, parseJsonObject, stringField } from './http.ts';
import { APP_TOKEN_SERVICE } from './keychain.ts';

// Margin subtracted from a cached token's expiry before trusting it, so a
// token that is about to die is re-minted instead of raced.
const EXPIRY_SKEW_MS = 30_000;

export async function appTokenFor(ctx: Context, email: string, appHost: string): Promise<string> {
  return cachedAppToken(ctx, email, appHost) ?? (await mintAppToken(ctx, email, appHost));
}

function cachedAppToken(ctx: Context, email: string, appHost: string): string | undefined {
  const raw = ctx.keychain.get(APP_TOKEN_SERVICE, `${email}:${appHost}`);
  if (!raw) return undefined;
  const separator = raw.indexOf(':');
  if (separator <= 0) return undefined;
  const expiry = Number(raw.slice(0, separator));
  const token = raw.slice(separator + 1);
  if (!Number.isFinite(expiry) || token === '') return undefined;
  return expiry - EXPIRY_SKEW_MS > ctx.now().getTime() ? token : undefined;
}

async function mintAppToken(ctx: Context, email: string, appHost: string): Promise<string> {
  const loginToken = requireLoginToken(ctx, email);
  const response = await ctx.http({
    method: 'POST',
    url: `${ctx.config.apexBaseUrl}/~/mint/app_id_token`,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${loginToken}`,
    },
    body: JSON.stringify({ target: appHost }),
  });
  const json = parseJsonObject(response.body);
  if (!isSuccess(response.status)) {
    const reason = stringField(json, 'error') ?? stringField(json, 'code') ?? 'mint_failed';
    throw new CliError(`unable to mint an app token for ${appHost}: ${reason} (http ${response.status})`);
  }
  const token = stringField(json, 'token');
  const expiry = json?.expires_at_millis;
  if (!token || typeof expiry !== 'number') {
    throw new CliError(`mint response for ${appHost} carried no token`);
  }
  ctx.keychain.set(APP_TOKEN_SERVICE, `${email}:${appHost}`, `${expiry}:${token}`);
  return token;
}
