// ./.pilely/tool.log — one JSON line per tool invocation, appended by the
// shared runner, so what every agent ran and what it got back can be read
// in one place afterwards. Outputs are cut to a few KB per line; the full
// message bodies are in the chatroom folders anyway. Logging never fails a
// command: a log that cannot be written is silently skipped.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ToolLogEntry {
  at: string;
  pid: number;
  tool: string;
  args: string[];
  exit_code: number;
  ms: number;
  stdout: string;
  stderr: string;
}

export const OUTPUT_CAP = 4000;

export function clip(text: string): string {
  return text.length <= OUTPUT_CAP ? text : `${text.slice(0, OUTPUT_CAP)}…[${text.length - OUTPUT_CAP} more]`;
}

export function appendToolLog(file: string, entry: ToolLogEntry): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify({ ...entry, stdout: clip(entry.stdout), stderr: clip(entry.stderr) })}\n`);
  } catch {
    // never let the log break the command
  }
}
