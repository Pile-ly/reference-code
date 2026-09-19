// Test doubles: an in-memory keychain, a scripted HTTP client that records
// every request, and a Context rooted in a fresh temp directory. No test
// touches the real keychain or the network.

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.ts';
import type { Context } from '../src/context.ts';
import type { HttpRequest, HttpResponse } from '../src/http.ts';
import type { Keychain } from '../src/keychain.ts';

export interface TestContext extends Context {
  dir: string;
  requests: HttpRequest[];
  notes: string[];
  secrets: Map<string, string>;
}

type Responder = (request: HttpRequest) => HttpResponse;

export const MINT_OK: HttpResponse = {
  status: 200,
  body: JSON.stringify({ ok: true, token: 'MINTED.TOKEN', expires_at_millis: 9_999_999_999_999 }),
};

export function testContext(respond: Responder = () => ({ status: 200, body: '{"ok":true}' })): TestContext {
  const dir = mkdtempSync(join(tmpdir(), 'pilely-agent-tools-'));
  const secrets = new Map<string, string>();
  const requests: HttpRequest[] = [];
  const notes: string[] = [];
  const keychain: Keychain = {
    get: (service, account) => secrets.get(`${service}/${account}`),
    set: (service, account, value) => void secrets.set(`${service}/${account}`, value),
    delete: (service, account) => void secrets.delete(`${service}/${account}`),
  };
  return {
    dir,
    requests,
    notes,
    secrets,
    config: {
      ...loadConfig({}),
      accountIdFile: join(dir, '.pilely_account_keychain_id'),
      workspaceFile: join(dir, '.pilely', 'workspace.json'),
      guideVersionFile: join(dir, '.pilely', 'pam_version.md'),
      chatroomsDir: join(dir, '.pilely', 'chatrooms'),
      listenerExpiryMs: 60 * 60 * 1000,
    },
    keychain,
    http: async (request) => {
      requests.push(request);
      return respond(request);
    },
    openEventStream: async function* () {},
    now: () => new Date('2026-09-17T20:15:00.123Z'),
    note: (line) => void notes.push(line),
  };
}
