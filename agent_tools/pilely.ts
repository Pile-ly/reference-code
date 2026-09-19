#!/usr/bin/env node
// The one entry point for the Pilely agent tools.
//
//   node .pilely/tools/pilely.ts fetch <arguments>
//   node .pilely/tools/pilely.ts token_store <arguments>
//   node .pilely/tools/pilely.ts workspace <arguments>
//
// Each tool's commands and usage are in src/commands/.

import { fileURLToPath } from 'node:url';
import { fetchCommand } from './src/commands/fetch.ts';
import { tokenStoreCommand } from './src/commands/token_store.ts';
import { workspaceCommand } from './src/commands/workspace.ts';
import { CliError } from './src/errors.ts';
import { runTool } from './src/run.ts';

// The chatroom listener starts this same file again as a detached process.
const entryPoint = fileURLToPath(import.meta.url);
const [tool, ...args] = process.argv.slice(2);

switch (tool) {
  case 'fetch':
    await runTool('pilely fetch', args, fetchCommand);
    break;
  case 'token_store':
    await runTool('pilely token_store', args, tokenStoreCommand);
    break;
  case 'workspace':
    await runTool('pilely workspace', args, (ctx, rest) => workspaceCommand(ctx, rest, entryPoint));
    break;
  default:
    await runTool('pilely', args, () => {
      throw new CliError('usage: pilely {fetch|token_store|workspace} <arguments>');
    });
}
