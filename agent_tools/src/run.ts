// The shared entry point: runs one command, writes its result, turns a
// failure into the tool's stderr line and exit code, and appends one line
// about the call to the tool log.

import { realContext } from './context.ts';
import type { Context } from './context.ts';
import { CliError } from './errors.ts';
import type { CommandResult } from './errors.ts';
import { appendToolLog } from './tool_log.ts';

type Command = (ctx: Context, args: string[]) => Promise<CommandResult> | CommandResult;

export async function runTool(toolName: string, args: string[], command: Command): Promise<void> {
  const started = Date.now();
  let ctx: Context | undefined;
  let stdout = '';
  let stderr = '';
  let exitCode = 0;
  try {
    ctx = realContext(toolName);
    const result = await command(ctx, args);
    stdout = result.stdout;
    exitCode = result.exitCode;
    process.stdout.write(stdout);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr = `${toolName}: ${message}\n`;
    exitCode = error instanceof CliError ? error.exitCode : 1;
    process.stderr.write(stderr);
  }
  process.exitCode = exitCode;
  if (ctx) {
    appendToolLog(ctx.config.toolLogFile, {
      at: new Date(started).toISOString(),
      pid: process.pid,
      tool: toolName,
      args,
      exit_code: exitCode,
      ms: Date.now() - started,
      stdout,
      stderr,
    });
  }
}
