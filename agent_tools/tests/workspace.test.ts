import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { writeAccountEmail } from '../src/account.ts';
import { workspaceCommand } from '../src/commands/workspace.ts';
import { testContext } from './helpers.ts';

const EMAIL = 'user@example.com';
const CREATED = JSON.stringify({
  ok: true,
  workspace: { workspace_nanoid: 'abcd1234', created_time_stamp: 1789674237255 },
});

function loggedIn(respond?: Parameters<typeof testContext>[0]) {
  const ctx = testContext(respond);
  writeAccountEmail(ctx, EMAIL);
  ctx.secrets.set(`pile.ly.app_token/${EMAIL}:simple-workspace.pilely.app`, '9999999999999:APP');
  return ctx;
}

test('register without a login fails and calls nothing', async () => {
  const ctx = testContext();
  await assert.rejects(workspaceCommand(ctx, ['register']), /no account on file/);
  assert.equal(ctx.requests.length, 0);
});

test('register creates once, writes the file, then never again', async () => {
  const ctx = loggedIn(() => ({ status: 200, body: CREATED }));
  const first = await workspaceCommand(ctx, ['register']);
  assert.equal(first.exitCode, 0);
  assert.deepEqual(JSON.parse(first.stdout), {
    workspace_nanoid: 'abcd1234',
    owner_email: EMAIL,
    created_time_stamp: 1789674237255,
  });
  assert.equal(readFileSync(ctx.config.workspaceFile, 'utf8'), first.stdout);
  const request = ctx.requests[0]!;
  assert.equal(request.url, 'https://simple-workspace.pilely.app/~/new_workspace');
  assert.equal(request.headers!.Accept, 'application/json');
  assert.equal(request.headers!.Authorization, 'Bearer APP');

  const second = await workspaceCommand(ctx, ['register']);
  assert.equal(second.stdout, first.stdout);
  assert.equal(ctx.requests.length, 1);
  assert.match(ctx.notes.at(-1)!, /already registered/);

  assert.equal((await workspaceCommand(ctx, ['info'])).stdout, first.stdout);
  assert.equal(ctx.requests.length, 1);
});

test('a failed create writes no file', async () => {
  const ctx = loggedIn(() => ({ status: 401, body: '{"ok":false,"code":"unauthorized"}' }));
  await assert.rejects(workspaceCommand(ctx, ['register']), /unauthorized/);
  assert.ok(!existsSync(ctx.config.workspaceFile));
});

test('a file naming no workspace is never registered over', async () => {
  const ctx = loggedIn(() => ({ status: 200, body: CREATED }));
  mkdirSync(dirname(ctx.config.workspaceFile), { recursive: true });
  writeFileSync(ctx.config.workspaceFile, '{}');
  await assert.rejects(workspaceCommand(ctx, ['register']), /names no workspace/);
  assert.equal(ctx.requests.length, 0);
});

test('info before register fails', async () => {
  await assert.rejects(workspaceCommand(testContext(), ['info']), /no workspace registered/);
});

test('guide-version: recorded, unchanged, changed; never a network call', async () => {
  const ctx = testContext();
  assert.equal((await workspaceCommand(ctx, ['guide-version', '2026.09.17.100000'])).stdout, 'recorded\n');
  assert.equal(
    readFileSync(ctx.config.guideVersionFile, 'utf8'),
    'skill_version: 2026.09.17.100000\nchecked_at: 2026-09-17T20:15:00Z\n',
  );
  assert.equal((await workspaceCommand(ctx, ['guide-version', '2026.09.17.100000'])).stdout, 'unchanged\n');
  assert.equal((await workspaceCommand(ctx, ['guide-version', '2026.09.18.090000'])).stdout, 'changed\n');
  assert.match(readFileSync(ctx.config.guideVersionFile, 'utf8'), /^skill_version: 2026\.09\.18\.090000$/m);
  assert.equal(ctx.requests.length, 0);
  await assert.rejects(workspaceCommand(ctx, ['guide-version', 'bad version; rm']), /not a skill version/);
  await assert.rejects(workspaceCommand(ctx, ['guide-version']), /usage:/);
});

test('usage', async () => {
  await assert.rejects(workspaceCommand(testContext(), []), /usage:/);
  await assert.rejects(workspaceCommand(testContext(), ['register', 'extra']), /usage:/);
});
