// An agent's own memory: one private text document per agent, kept in its
// state on @simple_agent and nowhere else. A teammate that is launched for
// one task and then ends writes here what its next launch must know; the
// handle is what the memory belongs to, so reusing a handle is reusing its
// memory.
//
//   memory get --as <handle>                  prints the memory, or nothing when none was written
//   memory put --as <handle> --text <content> replaces it

import { readState, writeOwnState } from '../agent_state.ts';
import type { Context } from '../context.ts';
import { CliError, ok } from '../errors.ts';
import type { CommandResult } from '../errors.ts';
import { requireAgent, requireWorkspaceFile } from '../workspace_file.ts';

export const MEMORY_SLOT = 'memory';

const USAGE = 'usage: pilely workspace memory {get --as <handle> | put --as <handle> --text <content>}';

export async function memoryCommand(ctx: Context, args: string[]): Promise<CommandResult> {
  const [sub, ...flags] = args;
  let handle: string | undefined;
  let text: string | undefined;
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--as') handle = flags[++i];
    else if (flags[i] === '--text' && sub === 'put') text = flags[++i];
    else throw new CliError(USAGE);
  }
  if (!handle) throw new CliError(USAGE);
  requireAgent(requireWorkspaceFile(ctx), handle);
  switch (sub) {
    case 'get': {
      const slot = await readState(ctx, handle, MEMORY_SLOT);
      return ok(slot?.content ?? '');
    }
    case 'put': {
      if (text === undefined) throw new CliError(USAGE);
      if (text.length === 0) throw new CliError('nothing to put: the content is empty');
      await writeOwnState(ctx, handle, MEMORY_SLOT, text);
      return ok('saved\n');
    }
    default:
      throw new CliError(USAGE);
  }
}
