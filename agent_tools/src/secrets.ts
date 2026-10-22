// An app's own secrets (Stripe keys, webhook signing secrets), kept in the
// keychain so their values never pass through an agent's context. A secret
// is named by a ref, `<app-host>/<NAME>`; only this file reads or writes
// the values, and nothing here ever prints one.
//
// Layout:
//   service pile.ly.secret        account <email>:<app-host>:<NAME>  value the secret
//   service pile.ly.secret_index  account <email>:<app-host>         value JSON array of NAMEs
//
// The keychain cannot list entries cheaply, so each app keeps an index of
// its names beside the values.

import type { Context } from './context.ts';
import { CliError } from './errors.ts';

export const SECRET_SERVICE = 'pile.ly.secret';
export const SECRET_INDEX_SERVICE = 'pile.ly.secret_index';

/** The only host outside Pilely a secret may be sent to. */
export const STRIPE_API_HOST = 'api.stripe.com';

const NAME_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const HOST_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const PLACEHOLDER = /\[\[secret:([^\[\]]+)\]\]/g;

export interface SecretRef {
  appHost: string;
  name: string;
}

export function parseAppHost(value: string): string {
  const host = value.toLowerCase();
  if (!HOST_PATTERN.test(host)) throw new CliError(`not an app host: ${value}`);
  return host;
}

export function parseSecretName(value: string): string {
  if (!NAME_PATTERN.test(value)) {
    throw new CliError(`not a secret name: ${value} (capital letters, digits and _, starting with a letter)`);
  }
  return value;
}

/** `<app-host>/<NAME>`. */
export function parseSecretRef(value: string): SecretRef {
  const slash = value.lastIndexOf('/');
  if (slash <= 0) throw new CliError(`not a secret ref: ${value} (expected <app-host>/<NAME>)`);
  return { appHost: parseAppHost(value.slice(0, slash)), name: parseSecretName(value.slice(slash + 1)) };
}

export function formatRef(ref: SecretRef): string {
  return `${ref.appHost}/${ref.name}`;
}

export function listSecrets(ctx: Context, email: string, appHost: string): string[] {
  const raw = ctx.keychain.get(SECRET_INDEX_SERVICE, `${email}:${appHost}`);
  if (!raw) return [];
  try {
    const names: unknown = JSON.parse(raw);
    return Array.isArray(names) ? names.filter((name): name is string => typeof name === 'string').sort() : [];
  } catch {
    return [];
  }
}

function writeIndex(ctx: Context, email: string, appHost: string, names: string[]): void {
  const account = `${email}:${appHost}`;
  if (names.length === 0) ctx.keychain.delete(SECRET_INDEX_SERVICE, account);
  else ctx.keychain.set(SECRET_INDEX_SERVICE, account, JSON.stringify([...new Set(names)].sort()));
}

export function saveSecret(ctx: Context, email: string, ref: SecretRef, value: string): void {
  ctx.keychain.set(SECRET_SERVICE, `${email}:${ref.appHost}:${ref.name}`, value);
  writeIndex(ctx, email, ref.appHost, [...listSecrets(ctx, email, ref.appHost), ref.name]);
}

export function deleteSecret(ctx: Context, email: string, ref: SecretRef): void {
  ctx.keychain.delete(SECRET_SERVICE, `${email}:${ref.appHost}:${ref.name}`);
  writeIndex(
    ctx,
    email,
    ref.appHost,
    listSecrets(ctx, email, ref.appHost).filter((name) => name !== ref.name),
  );
}

export function requireSecret(ctx: Context, email: string, ref: SecretRef): string {
  const value = ctx.keychain.get(SECRET_SERVICE, `${email}:${ref.appHost}:${ref.name}`);
  if (!value) throw new CliError(`no secret saved as ${formatRef(ref)}`);
  return value;
}

export function hasPlaceholder(text: string | undefined): boolean {
  return text !== undefined && new RegExp(PLACEHOLDER.source).test(text);
}

/**
 * Replaces every `[[secret:<app-host>/<NAME>]]` with the saved value,
 * escaped for where it lands: inside a JSON string, or as a form value.
 * Returns the values used, so the caller can keep them out of its output.
 */
export function fillPlaceholders(
  ctx: Context,
  email: string,
  text: string,
  encoding: 'json' | 'form',
): { text: string; used: string[] } {
  const used: string[] = [];
  const filled = text.replace(PLACEHOLDER, (_, ref: string) => {
    const value = requireSecret(ctx, email, parseSecretRef(ref));
    used.push(value);
    return encoding === 'json' ? JSON.stringify(value).slice(1, -1) : encodeURIComponent(value);
  });
  return { text: filled, used };
}

// Stripe's secret key shapes. A publishable key (`pk_`) is not a secret.
const KNOWN_SECRET = /\b(?:sk_live|sk_test|rk_live|rk_test|whsec|ek_live|ek_test|ek)_[A-Za-z0-9_]+/g;

/**
 * The backstop on every byte the fetch tool prints: each value this call
 * used, and anything shaped like a Stripe secret, becomes `<redacted>`.
 */
export function redactSecrets(text: string, used: string[] = []): string {
  let out = text;
  for (const value of used) {
    if (value.length >= 8) out = out.split(value).join('<redacted>');
  }
  return out.replace(KNOWN_SECRET, '<redacted>');
}
