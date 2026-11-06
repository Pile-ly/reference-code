// pilely secret_store — an app's own secrets, in the keychain.
//
//   pilely secret_store ask <app-host> <NAME> <prompt> [--expect <prefix>]
//   pilely secret_store list <app-host>
//   pilely secret_store delete <app-host> <NAME>
//
// No command here prints a value, and none takes one as an argument: a
// secret comes in through the window `ask` opens for the person, or from a
// response through `pilely fetch --save-secret`, and goes out only inside
// a `pilely fetch` call (`[[secret:<app-host>/<NAME>]]`, `--bearer-secret`).
//
// `ask` prints `saved <NAME>` (exit 0), `cancelled` (exit 3), or
// `not_saved: it does not start with <prefix>` (exit 1, nothing saved).

import { requireAccountEmail } from '../account.ts';
import type { Context } from '../context.ts';
import { CliError, failed, ok } from '../errors.ts';
import type { CommandResult } from '../errors.ts';
import { deleteSecret, listSecrets, parseAppHost, parseSecretName, saveSecret } from '../secrets.ts';

const USAGE =
  'usage: pilely secret_store {ask <app-host> <NAME> <prompt> [--expect <prefix>]|list <app-host>|delete <app-host> <NAME>}';
const ASK_USAGE = 'usage: pilely secret_store ask <app-host> <NAME> <prompt> [--expect <prefix>]';

export const CANCELLED_EXIT = 3;

export function secretStoreCommand(ctx: Context, args: string[]): CommandResult {
  const [command, ...rest] = args;
  switch (command) {
    case 'ask':
      return ask(ctx, rest);
    case 'list': {
      if (rest.length !== 1) throw new CliError('usage: pilely secret_store list <app-host>');
      const names = listSecrets(ctx, requireAccountEmail(ctx), parseAppHost(rest[0]!));
      return ok(names.length === 0 ? 'none\n' : `${names.join('\n')}\n`);
    }
    case 'delete': {
      if (rest.length !== 2) throw new CliError('usage: pilely secret_store delete <app-host> <NAME>');
      const ref = { appHost: parseAppHost(rest[0]!), name: parseSecretName(rest[1]!) };
      deleteSecret(ctx, requireAccountEmail(ctx), ref);
      return ok(`deleted ${ref.name}\n`);
    }
    default:
      throw new CliError(USAGE);
  }
}

function ask(ctx: Context, args: string[]): CommandResult {
  const positional: string[] = [];
  let expect: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--expect') {
      const value = args[++i];
      if (!value || expect !== undefined) throw new CliError(ASK_USAGE);
      expect = value;
    } else positional.push(arg);
  }
  if (positional.length !== 3 || positional[2]!.trim() === '') throw new CliError(ASK_USAGE);
  const ref = { appHost: parseAppHost(positional[0]!), name: parseSecretName(positional[1]!) };
  const email = requireAccountEmail(ctx);

  // A paste often brings a space or a line break along; a key never has one.
  const value = ctx.askSecret(`Pilely — ${ref.appHost}`, positional[2]!)?.trim();
  if (!value) return failed('cancelled\n', CANCELLED_EXIT);
  if (expect !== undefined && !value.startsWith(expect)) {
    return failed(`not_saved: it does not start with ${expect}\n`);
  }
  saveSecret(ctx, email, ref, value);
  return ok(`saved ${ref.name}\n`);
}
