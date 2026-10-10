// The macOS keychain, through the `security` command. This is the only
// secret store the tools support, and this file is the only place that
// touches it.
//
// Layout (fixed — the login flow and the fetch tool share it):
//   service pile.ly            account <email>              value <jwt>
//   service pile.ly.app_token  account <email>:<app-host>   value <expiry_millis>:<token>
//   service pile.ly.agent_token account <agent handle>        value <expiry_millis>:<token>

import { execFileSync } from 'node:child_process';
import { CliError } from './errors.ts';

export const LOGIN_SERVICE = 'pile.ly';
export const APP_TOKEN_SERVICE = 'pile.ly.app_token';
export const AGENT_TOKEN_SERVICE = 'pile.ly.agent_token';

export interface Keychain {
  /** The stored value, or undefined when there is no such entry. */
  get(service: string, account: string): string | undefined;
  set(service: string, account: string, value: string): void;
  /** Removes the entry; a missing entry is not an error. */
  delete(service: string, account: string): void;
}

export function requireMacos(platform: string = process.platform): void {
  if (platform !== 'darwin') {
    throw new CliError('macOS only: the keychain is the only supported secret store');
  }
}

export const macosKeychain: Keychain = {
  get(service, account) {
    try {
      const out = execFileSync(
        'security',
        ['find-generic-password', '-s', service, '-a', account, '-w'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      );
      return out.replace(/\n$/, '');
    } catch {
      return undefined;
    }
  },

  set(service, account, value) {
    try {
      execFileSync(
        'security',
        ['add-generic-password', '-s', service, '-a', account, '-w', value, '-U'],
        { stdio: 'ignore' },
      );
    } catch {
      throw new CliError(`unable to write keychain entry ${service}/${account}`);
    }
  },

  delete(service, account) {
    try {
      execFileSync('security', ['delete-generic-password', '-s', service, '-a', account], { stdio: 'ignore' });
    } catch {
      // nothing stored under that name
    }
  },
};
