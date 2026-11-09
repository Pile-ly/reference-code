import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { rawDir, roomFile, sequenceFileName } from '../src/chatroom_files.ts';
import { DEFAULT_PORT, choosePort, readDashboardState, serveDashboard } from '../src/commands/dashboard.ts';
import { dashboardPageDirFor } from '../src/config.ts';
import { stopProcess } from '../src/commands/listener.ts';
import { workspaceCommand } from '../src/commands/workspace.ts';
import { CliError } from '../src/errors.ts';
import { writeWorkspaceFile } from '../src/workspace_file.ts';
import { testContext } from './helpers.ts';
import type { TestContext } from './helpers.ts';

const PAM_ID = '00000000-0000-0000-0000-000000000001';
const OSCAR_ID = '00000000-0000-0000-0000-000000000002';

/** A folder with two agents on file, two rooms with saved messages, a tool log and the page's own files. */
function folder(): TestContext {
  const ctx = testContext();
  writeWorkspaceFile(ctx, {
    workspace_nanoid: 'ws_secret_nanoid',
    owner_email: 'owner@example.com',
    created_time_stamp: 1,
    default_chatroom: 'main1',
    agents: {
      a1: { type: 'pam', purpose: 'speaks for the user', agent_id: PAM_ID, in_workspace: true, chatrooms: ['main1', 'app1'], created_time_stamp: 'x' },
      a2: { type: 'oscar', purpose: 'checks things', agent_id: OSCAR_ID, in_workspace: true, chatrooms: ['app1'], created_time_stamp: 'x' },
    },
  });
  const room = (id: string, title: string, isDefault: boolean) => {
    mkdirSync(rawDir(ctx, id), { recursive: true });
    writeFileSync(roomFile(ctx, id), JSON.stringify({ room_nanoid: id, title, created_by: 'a1', is_default: isDefault, created_time_stamp: 5 }));
  };
  room('main1', 'main', true);
  room('app1', 'Recipe box', false);
  for (const sequence of [3, 1, 2]) {
    const message = { id: `m${sequence}`, room_id: 'app1', sequence, sender_agent_id: PAM_ID, sender_handle: 'a1', text: `line ${sequence}`, mentions: [] };
    writeFileSync(join(rawDir(ctx, 'app1'), sequenceFileName(sequence)), JSON.stringify(message));
  }
  mkdirSync(join(ctx.dir, '.pilely', 'chatrooms', 'app1', 'artifacts'), { recursive: true });
  writeFileSync(join(ctx.dir, '.pilely', 'chatrooms', 'app1', 'artifacts', 'ux_design.md'), 'private artifact');
  writeFileSync(ctx.config.toolLogFile, '{"secret":"tool log"}\n');

  const page = ctx.config.dashboardPageDir;
  mkdirSync(join(page, 'locales'), { recursive: true });
  writeFileSync(join(page, 'index.html'), '<!doctype html><head><meta name="pilely-dashboard-lang" content=""></head><body>page</body>\n');
  writeFileSync(join(page, 'app.js'), 'console.log(1);\n');
  writeFileSync(join(page, 'locales', 'en.json'), '{"hello":"Hello"}\n');
  symlinkSync(ctx.config.workspaceFile, join(page, 'leak.json'));
  return ctx;
}

const portOf = (server: Server) => (server.address() as AddressInfo).port;
const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()));

/** A raw GET, so a test can send a path or Host header no URL parser would keep. */
function get(port: number, path: string, options: { host?: string; method?: string } = {}): Promise<{ status: number; type: string; body: string }> {
  return new Promise((resolve, reject) => {
    const sent = request(
      { host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: { host: options.host ?? `localhost:${port}` } },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, type: String(response.headers['content-type'] ?? ''), body: Buffer.concat(chunks).toString('utf8') }),
        );
      },
    );
    sent.on('error', reject);
    sent.end();
  });
}

const getJson = async (port: number, path: string) => {
  const answer = await get(port, path);
  assert.equal(answer.status, 200, path);
  assert.match(answer.type, /^application\/json/);
  return JSON.parse(answer.body) as unknown;
};

test('the server listens on 127.0.0.1 only', async () => {
  const ctx = folder();
  const server = await serveDashboard(ctx, 0);
  try {
    assert.equal((server.address() as AddressInfo).address, '127.0.0.1');
  } finally {
    await close(server);
  }
});

test('/api/rooms, /api/agents and /api/messages answer from the folder\'s files', async () => {
  const ctx = folder();
  const server = await serveDashboard(ctx, 0);
  const port = portOf(server);
  try {
    const rooms = (await getJson(port, '/api/rooms')) as { room_nanoid: string; title: string; is_default: boolean }[];
    assert.deepEqual(rooms.map((room) => [room.room_nanoid, room.title, room.is_default]).sort(), [['app1', 'Recipe box', false], ['main1', 'main', true]]);

    const agents = await getJson(port, '/api/agents');
    assert.deepEqual(agents, { [PAM_ID]: 'pam', [OSCAR_ID]: 'oscar' });
    const raw = JSON.stringify(agents);
    for (const hidden of ['owner@example.com', 'ws_secret_nanoid', 'main1', 'a1', 'speaks for the user', 'purpose', 'chatrooms']) {
      assert.equal(raw.includes(hidden), false, hidden);
    }

    const all = (await getJson(port, '/api/messages?room=app1')) as { sequence: number; text: string; sender_agent_id: string }[];
    assert.deepEqual(all.map((m) => m.sequence), [1, 2, 3]);
    assert.equal(all[0]!.sender_agent_id, PAM_ID);
    assert.deepEqual(((await getJson(port, '/api/messages?room=app1&after=1')) as { sequence: number }[]).map((m) => m.sequence), [2, 3]);
    assert.deepEqual(await getJson(port, '/api/messages?room=app1&after=3'), []);
    assert.deepEqual(await getJson(port, '/api/messages?room=main1&after=0'), []);
    assert.deepEqual(await getJson(port, '/api/messages?room=nosuchroom'), []);
  } finally {
    await close(server);
  }
});

test('/ serves the page with Pam\'s language in its meta tag, and the page\'s assets with their types', async () => {
  const ctx = folder();
  const server = await serveDashboard(ctx, 0);
  const port = portOf(server);
  try {
    const empty = await get(port, '/');
    assert.equal(empty.status, 200);
    assert.match(empty.type, /^text\/html/);
    assert.match(empty.body, /<meta name="pilely-dashboard-lang" content="">/);

    mkdirSync(ctx.config.dashboardDir, { recursive: true });
    writeFileSync(join(ctx.config.dashboardDir, 'state.json'), JSON.stringify({ port, lang: 'ar' }));
    assert.match((await get(port, '/')).body, /<meta name="pilely-dashboard-lang" content="ar">/);

    const script = await get(port, '/app.js');
    assert.equal(script.status, 200);
    assert.match(script.type, /^text\/javascript/);
    const words = await get(port, '/locales/en.json');
    assert.equal(words.status, 200);
    assert.match(words.type, /^application\/json/);
    assert.equal(JSON.parse(words.body).hello, 'Hello');
  } finally {
    await close(server);
  }
});

test('every other path, every other file under .pilely/ and any other method is refused', async () => {
  const ctx = folder();
  const server = await serveDashboard(ctx, 0);
  const port = portOf(server);
  try {
    for (const path of [
      '/nothing.html',
      '/api',
      '/api/other',
      '/api/messages',
      '/api/messages?room=../..&after=0',
      '/api/messages?room=app1&after=-1',
      '/api/messages?room=app1&after=x',
      '/.pilely/tool.log',
      '/.pilely/workspace.json',
      '/workspace.json',
      '/tool.log',
      '/../.pilely/tool.log',
      '/..%2f.pilely%2ftool.log',
      '/%2e%2e/%2e%2e/.pilely/workspace.json',
      '/locales/../../.pilely/workspace.json',
      '/locales/..%2f..%2f.pilely%2fworkspace.json',
      '/chatrooms/app1/artifacts/ux_design.md',
      '/leak.json',
      '/locales',
      '/%zz',
    ]) {
      const answer = await get(port, path);
      assert.equal(answer.status, 404, path);
      for (const secret of ['owner@example.com', 'tool log', 'private artifact']) assert.equal(answer.body.includes(secret), false, path);
    }
    assert.equal((await get(port, '/api/rooms', { method: 'POST' })).status, 405);
    assert.equal((await get(port, '/', { method: 'DELETE' })).status, 405);
    // a page on another site reaching this port through a name it controls
    assert.equal((await get(port, '/api/agents', { host: 'evil.example:80' })).status, 404);
    assert.equal((await get(port, '/api/agents', { host: `127.0.0.1:${port}` })).status, 200);
  } finally {
    await close(server);
  }
});

test('the port is 4317 by preference, else the next free one', async () => {
  assert.equal(DEFAULT_PORT, 4317);
  const holder = await serveDashboard(testContext(), 0);
  const held = portOf(holder);
  try {
    const chosen = await choosePort(held);
    assert.ok(chosen > held, `${chosen} after ${held}`);
    await close(holder);
    assert.equal(await choosePort(held), held);
  } finally {
    holder.close();
  }
});

/**
 * A dashboard entry point that listens where it is told: its command line
 * reads `<entry> workspace run-dashboard --port <n>`, so the tools see a
 * running dashboard server, and it answers on that port.
 */
function dashboardStub(ctx: TestContext): string {
  const entry = join(ctx.dir, 'dashboard_stub.mjs');
  writeFileSync(
    entry,
    "import { createServer } from 'node:http';\n" +
      "const port = Number(process.argv[process.argv.indexOf('--port') + 1]);\n" +
      "createServer((q, s) => s.end('stub')).listen(port, '127.0.0.1');\n",
  );
  return entry;
}

const serverPid = (ctx: TestContext) => Number(readFileSync(join(ctx.config.dashboardDir, 'server.pid'), 'utf8').trim());

test('dashboard starts the server, a second run reuses it, and a run after it stopped comes back on the same port', async () => {
  const ctx = folder();
  const entry = dashboardStub(ctx);
  const first = await workspaceCommand(ctx, ['dashboard', '--lang', 'ja'], entry);
  assert.equal(first.exitCode, 0);
  const match = first.stdout.match(/^http:\/\/localhost:(\d+)\/\n$/);
  assert.ok(match, first.stdout);
  const port = Number(match[1]);
  assert.ok(port >= DEFAULT_PORT);
  assert.deepEqual(readDashboardState(ctx), { port, lang: 'ja' });
  const pid = serverPid(ctx);
  assert.equal((await get(port, '/')).body, 'stub');

  try {
    // running: same address, same process; a new --lang replaces the remembered one, none keeps it
    assert.deepEqual(await workspaceCommand(ctx, ['dashboard', '--lang', 'FR'], entry), first);
    assert.equal(serverPid(ctx), pid);
    assert.deepEqual(readDashboardState(ctx), { port, lang: 'fr' });
    assert.deepEqual(await workspaceCommand(ctx, ['dashboard'], entry), first);
    assert.deepEqual(readDashboardState(ctx), { port, lang: 'fr' });
  } finally {
    await stopProcess(pid, () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    });
  }

  // stopped: the stale pid file is dropped and the remembered port is used again
  const again = await workspaceCommand(ctx, ['dashboard'], entry);
  assert.deepEqual(again, first);
  const restarted = serverPid(ctx);
  assert.notEqual(restarted, pid);
  assert.deepEqual(readDashboardState(ctx), { port, lang: 'fr' });
  process.kill(restarted, 'SIGTERM');
});

test('a remembered port that something else now holds moves the server to the next free one', async () => {
  const ctx = folder();
  const entry = dashboardStub(ctx);
  const holder = await serveDashboard(testContext(), 0);
  const held = portOf(holder);
  mkdirSync(ctx.config.dashboardDir, { recursive: true });
  writeFileSync(join(ctx.config.dashboardDir, 'state.json'), JSON.stringify({ port: held, lang: '' }));
  try {
    const result = await workspaceCommand(ctx, ['dashboard'], entry);
    const port = Number(result.stdout.match(/localhost:(\d+)\//)?.[1]);
    assert.ok(port > held, result.stdout);
    assert.equal(readDashboardState(ctx).port, port);
    process.kill(serverPid(ctx), 'SIGTERM');
  } finally {
    await close(holder);
  }
});

test('a bad --lang, or any other argument, is a usage error and starts nothing', async () => {
  const ctx = folder();
  const entry = dashboardStub(ctx);
  for (const args of [['--lang', 'xx'], ['--lang', 'en-US'], ['--lang'], ['--lang', 'en', '--lang', 'fr'], ['en'], ['--port', '1']]) {
    await assert.rejects(workspaceCommand(ctx, ['dashboard', ...args], entry), (error: unknown) => {
      assert.ok(error instanceof CliError);
      assert.match(error.message, /usage: pilely workspace dashboard \[--lang <code>\]/);
      return true;
    }, args.join(' '));
  }
  assert.equal(existsSync(join(ctx.config.dashboardDir, 'server.pid')), false);
  await assert.rejects(workspaceCommand(ctx, ['run-dashboard'], entry), CliError);
});

test('the page folder is the app_progress_dashboard beside the tools, else the kept download', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pilely-page-dir-'));
  mkdirSync(join(dir, 'reference-code', 'agent_tools'), { recursive: true });
  mkdirSync(join(dir, 'reference-code', 'app_progress_dashboard'));
  assert.equal(dashboardPageDirFor(join(dir, 'reference-code', 'agent_tools')), join(dir, 'reference-code', 'app_progress_dashboard'));
  mkdirSync(join(dir, 'tools'));
  assert.equal(dashboardPageDirFor(join(dir, 'tools')), './.pilely/reference-code/app_progress_dashboard');
});
