import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { appendToolLog, OUTPUT_CAP } from '../src/tool_log.ts';
import { testContext } from './helpers.ts';

const entry = (over: Partial<Parameters<typeof appendToolLog>[1]> = {}) => ({
  at: '2026-09-17T20:15:00.123Z',
  pid: 42,
  tool: 'pilely workspace',
  args: ['list-agents', 'room1'],
  exit_code: 0,
  ms: 12,
  stdout: 'h1 pam running the switchboard\n',
  stderr: '',
  ...over,
});

test('each call appends one JSON line, creating the folder', () => {
  const ctx = testContext();
  appendToolLog(ctx.config.toolLogFile, entry());
  appendToolLog(ctx.config.toolLogFile, entry({ args: ['agent-status', 'h1'], exit_code: 3, ms: 5 }));
  const lines = readFileSync(ctx.config.toolLogFile, 'utf8').trimEnd().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(JSON.parse(lines[0]!), entry());
  assert.equal(JSON.parse(lines[1]!).exit_code, 3);
});

test('long output is clipped and says how much was cut', () => {
  const ctx = testContext();
  appendToolLog(ctx.config.toolLogFile, entry({ stdout: 'x'.repeat(OUTPUT_CAP + 100) }));
  const logged = JSON.parse(readFileSync(ctx.config.toolLogFile, 'utf8')).stdout as string;
  assert.ok(logged.startsWith('x'.repeat(OUTPUT_CAP)));
  assert.ok(logged.endsWith('…[100 more]'));
});

test('an unwritable log never throws', () => {
  const ctx = testContext();
  const blocked = join(ctx.config.accountIdFile, 'tool.log'); // parent is a file, not a folder
  appendToolLog(blocked, entry());
});
