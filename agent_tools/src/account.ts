// Which account this working directory is logged in as. The file holds
// the email only; the token it names lives in the keychain.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Context } from './context.ts';
import { CliError } from './errors.ts';
import { LOGIN_SERVICE } from './keychain.ts';

/** The email on file, or undefined when nobody has logged in here. */
export function readAccountEmail(ctx: Context): string | undefined {
  const file = ctx.config.accountIdFile;
  if (!existsSync(file)) return undefined;
  return readFileSync(file, 'utf8').trim() || undefined;
}

export function requireAccountEmail(ctx: Context): string {
  const email = readAccountEmail(ctx);
  if (!email) {
    throw new CliError(
      `no account on file: ${ctx.config.accountIdFile} (log in with pilely token_store verify-email-code first)`,
    );
  }
  return email;
}

export function writeAccountEmail(ctx: Context, email: string): void {
  writeFileSync(ctx.config.accountIdFile, `${email}\n`);
}

export function requireLoginToken(ctx: Context, email: string): string {
  const token = ctx.keychain.get(LOGIN_SERVICE, email);
  if (!token) {
    throw new CliError(
      `no login token stored for ${email}; run pilely token_store send-email-code and verify-email-code first`,
    );
  }
  return token;
}
