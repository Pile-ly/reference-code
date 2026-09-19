// Everything a command needs from the outside world. Commands take a
// Context instead of reaching for globals, so a test can hand them an
// in-memory keychain, a scripted HTTP client and a temp directory.

import { loadConfig } from './config.ts';
import type { Config } from './config.ts';
import { createHttpClient } from './http.ts';
import type { HttpClient } from './http.ts';
import { openEventStream } from './sse.ts';
import type { EventStreamOpener } from './sse.ts';
import { macosKeychain, requireMacos } from './keychain.ts';
import type { Keychain } from './keychain.ts';

export interface Context {
  config: Config;
  keychain: Keychain;
  http: HttpClient;
  /** Opens a long-lived SSE connection; the listener's only use of the network besides `http`. */
  openEventStream: EventStreamOpener;
  now: () => Date;
  /** Progress notes for the person running the tool; never part of the result. */
  note: (line: string) => void;
}

export function realContext(toolName: string): Context {
  requireMacos();
  const config = loadConfig();
  return {
    config,
    keychain: macosKeychain,
    http: createHttpClient(config.requestTimeoutMs),
    openEventStream,
    now: () => new Date(),
    note: (line) => process.stderr.write(`${toolName}: ${line}\n`),
  };
}
