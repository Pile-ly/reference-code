// One error type for everything a tool reports to its caller. A CliError
// is an expected failure: its message goes to stderr, prefixed with the
// tool's name, and the process exits with `exitCode`. Anything else that
// escapes is a bug and is reported the same way with exit code 1.

export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = 'CliError';
    this.exitCode = exitCode;
  }
}

/** What a command hands back: text for stdout (may be empty) and the exit code. */
export interface CommandResult {
  stdout: string;
  exitCode: number;
}

export function ok(stdout = ''): CommandResult {
  return { stdout, exitCode: 0 };
}

export function failed(stdout: string, exitCode = 1): CommandResult {
  return { stdout, exitCode };
}
