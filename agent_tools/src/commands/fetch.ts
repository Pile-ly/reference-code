// pilely fetch — the one HTTP call every agent makes.
//
//   pilely fetch GET  <url>
//   pilely fetch POST <url> [<json body>] [--as <app-host>] [--json]
//
// Prints the response body and nothing else. Exits 0 on a 2xx response,
// 4 on 4xx, 5 on 5xx, 1 on anything else.

import type { Context } from '../context.ts';
import { CliError } from '../errors.ts';
import type { CommandResult } from '../errors.ts';
import { pilelyRequest } from '../pilely_request.ts';
import type { PilelyRequest } from '../pilely_request.ts';

const USAGE = 'usage: pilely fetch {GET <url>|POST <url> [<json body>] [--as <app-host>] [--json]}';

export async function fetchCommand(ctx: Context, args: string[]): Promise<CommandResult> {
  const response = await pilelyRequest(ctx, parseArgs(args));
  return { stdout: response.body, exitCode: exitCodeFor(response.status) };
}

export function parseArgs(args: string[]): PilelyRequest {
  const [method, url, ...rest] = args;
  if (!method || !url) throw new CliError(USAGE);

  if (method === 'GET') {
    if (rest.length > 0) throw new CliError('usage: pilely fetch GET <url>');
    return { method, url };
  }
  if (method !== 'POST') throw new CliError(USAGE);

  const request: PilelyRequest = { method, url };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === '--as') {
      const host = rest[++i];
      if (!host) throw new CliError(USAGE);
      request.asAppHost = host;
    } else if (arg === '--json') {
      request.wantJson = true;
    } else if (request.jsonBody === undefined) {
      request.jsonBody = arg;
    } else {
      throw new CliError(USAGE);
    }
  }
  return request;
}

function exitCodeFor(status: number): number {
  if (status >= 200 && status < 300) return 0;
  if (status >= 400 && status < 500) return 4;
  if (status >= 500 && status < 600) return 5;
  return 1;
}
