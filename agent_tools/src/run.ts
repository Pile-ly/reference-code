// The shared entry point: runs one command, writes its result, and turns
// a failure into the tool's stderr line and exit code.

import { realContext } from './context.ts';
import type { Context } from './context.ts';
import { CliError } from './errors.ts';
import type { CommandResult } from './errors.ts';

type Command = (ctx: Context, args: string[]) => Promise<CommandResult> | CommandResult;

export async function runTool(toolName: string, args: string[], command: Command): Promise<void> {
  try {
    const result = await command(realContext(toolName), args);
    process.stdout.write(result.stdout);
    process.exitCode = result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${toolName}: ${message}\n`);
    process.exitCode = error instanceof CliError ? error.exitCode : 1;
  }
}
