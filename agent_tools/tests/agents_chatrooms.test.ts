import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { writeAccountEmail } from '../src/account.ts';
import { agentDir, rawDir, roomDir } from '../src/chatroom_files.ts';
import { NOTHING_YET } from '../src/commands/chatrooms.ts';
import { createExpiry, listenOnce, nextRetryDelay } from '../src/commands/listener.ts';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from '../src/config.ts';
import { workspaceCommand } from '../src/commands/workspace.ts';
import { NOT_RUNNING } from '../src/commands/agents.ts';
import { dwightRun, parseMonitorRequest, sweepWatchList } from '../src/commands/dwight.ts';
import { isHeartbeatFresh } from '../src/liveness.ts';
import type { Heartbeat } from '../src/liveness.ts';
import type { HttpRequest, HttpResponse } from '../src/http.ts';
import { parseEventStream } from '../src/sse.ts';
import type { SseEvent } from '../src/sse.ts';
import { writeWorkspaceFile } from '../src/workspace_file.ts';
import { testContext } from './helpers.ts';
import type { TestContext } from './helpers.ts';

const EMAIL = 'user@example.com';
const APP_ID = '11111111-1111-1111-1111-111111111111';

const jwtFor = (agentId: string) =>
  `h.${Buffer.from(JSON.stringify({ sub: agentId, ptt: 'agent' })).toString('base64url')}.s`;
const json = (status: number, body: unknown): HttpResponse => ({ status, body: JSON.stringify(body) });

/** A scripted platform: mints handles a1, a2…, agent ids, rooms r1, r2… */
function platform() {
  let agents = 0;
  let rooms = 0;
  const ids = new Map<string, string>();
  const slots = new Map<string, string>();
  const artifacts: { id: string; name: string; content: string; created_by_handle: string; byte_size: number; created_time_stamp: number }[] = [];
  const respond = (request: HttpRequest): HttpResponse => {
    const { pathname } = new URL(request.url);
    if (pathname === '/~/mint/app_id_token') return json(200, { token: `APP.${JSON.parse(request.body!).target}`, expires_at_millis: 9_999_999_999_999 });
    if (pathname === '/~/apps/list') return json(200, { ok: true, piles: [{ pile_id: APP_ID }] });
    if (pathname === '/~/new_agent') {
      const handle = `a${++agents}`;
      ids.set(handle, `00000000-0000-0000-0000-00000000000${agents}`);
      return json(201, { agent: { handle } });
    }
    const issue = pathname.match(/^\/@(\w+)\/issue_id_token$/);
    if (issue) return json(201, { id_token: { token: jwtFor(ids.get(issue[1]!)!), expires_at: '2026-09-17T21:15:00.000Z' } });
    const state = pathname.match(/^\/@(\w+)\/states\/([\w-]+)\/(read|replace)$/);
    if (state) {
      const key = `${state[1]}/${state[2]}`;
      if (state[3] === 'replace') {
        slots.set(key, String(JSON.parse(request.body!).content));
        return json(200, { ok: true });
      }
      const content = slots.get(key);
      return content === undefined
        ? json(404, { ok: false, code: 'agent_not_found' })
        : json(200, { state: { state_identifier: state[2], content, updated_at: '2026-09-17T20:15:00.000Z' } });
    }
    if (pathname.endsWith('/artifacts/new')) {
      const body = JSON.parse(request.body!);
      const id = `art${artifacts.length + 1}`;
      artifacts.unshift({ id, name: body.name, content: body.content, created_by_handle: 'a1', byte_size: body.content.length, created_time_stamp: artifacts.length + 1 });
      return json(200, { ok: true, artifact: { id, name: body.name, byte_size: body.content.length } });
    }
    if (pathname.endsWith('/artifacts/list')) {
      return json(200, { ok: true, artifacts: artifacts.map(({ content, ...meta }) => meta), next_cursor: null });
    }
    const read = pathname.match(/\/artifacts\/@(\w+)\/read$/);
    if (read) {
      const found = artifacts.find((a) => a.id === read[1]);
      return found ? { status: 200, body: found.content } : json(404, { ok: false });
    }
    if (pathname.endsWith('/rooms/new')) return json(200, { ok: true, room: { id: `r${++rooms}`, created_time_stamp: 1 } });
    if (pathname.endsWith('/messages/send')) return json(200, { ok: true, message: { id: 'm1', sequence: 1, ...JSON.parse(request.body!) } });
    if (pathname.endsWith('/messages/subscribe')) return json(200, { ok: true, url: 'https://simple-wss.pilely.app/connect?type=SSE' });
    return json(200, { ok: true });
  };
  return Object.assign(respond, { slots });
}

function registered(): TestContext {
  const ctx = testContext(platform());
  writeAccountEmail(ctx, EMAIL);
  ctx.secrets.set(`pile.ly/${EMAIL}`, 'LOGIN.JWT');
  writeWorkspaceFile(ctx, { workspace_nanoid: 'ws123456', owner_email: EMAIL, created_time_stamp: 1 });
  return ctx;
}

const run = async (ctx: TestContext, ...args: string[]) => (await workspaceCommand(ctx, args, '/no/such/entry.ts')).stdout.trim();
const workspaceOf = (ctx: TestContext) => JSON.parse(readFileSync(ctx.config.workspaceFile, 'utf8'));
const paths = (ctx: TestContext) => ctx.requests.map((request) => new URL(request.url).pathname);

test('init-agent creates the agent, reads its id from the token, records it outside the workspace', async () => {
  const ctx = registered();
  assert.equal(await run(ctx, 'init-agent', 'pam', '--purpose', 'test pam'), 'a1');
  const workspace = workspaceOf(ctx);
  assert.equal(workspace.app_id, APP_ID);
  assert.deepEqual(workspace.agents.a1, {
    type: 'pam',
    purpose: 'test pam',
    agent_id: '00000000-0000-0000-0000-000000000001',
    in_workspace: false,
    chatrooms: [],
    created_time_stamp: '2026-09-17T20:15:00.123Z',
  });
  assert.ok(ctx.secrets.get('pile.ly.agent_token/a1')!.endsWith(jwtFor(workspace.agents.a1.agent_id)));
  const create = ctx.requests.find((request) => request.url.endsWith('/~/new_agent'))!;
  assert.deepEqual(JSON.parse(create.body!), { app_id: APP_ID });
  await assert.rejects(run(ctx, 'init-agent', 'Bad Type', '--purpose', 'x y z'), /not an agent type/);
  await assert.rejects(run(ctx, 'init-agent', 'oscar'), /usage:.*--purpose/);
  await assert.rejects(run(ctx, 'init-agent', 'oscar', '--purpose', 'ab'), /--purpose must be one line/);
});

test('two agents of one type get two handles', async () => {
  const ctx = registered();
  assert.equal(await run(ctx, 'init-agent', 'oscar', '--purpose', 'test oscar'), 'a1');
  assert.equal(await run(ctx, 'init-agent', 'oscar', '--purpose', 'test oscar'), 'a2');
  assert.equal(JSON.parse(await run(ctx, 'list-agents', '--type', 'oscar', '--json')).length, 2);
});

test('add-agent-to-workspace is called as the owner, once', async () => {
  const ctx = registered();
  await run(ctx, 'init-agent', 'pam', '--purpose', 'test pam');
  assert.equal(await run(ctx, 'add-agent-to-workspace', 'a1'), 'added');
  const add = ctx.requests.at(-1)!;
  assert.equal(new URL(add.url).pathname, '/@ws123456/agents/add');
  assert.equal(add.headers!.Authorization, 'Bearer APP.simple-workspace.pilely.app');
  assert.deepEqual(JSON.parse(add.body!), { agent_id: '00000000-0000-0000-0000-000000000001' });
  const calls = ctx.requests.length;
  assert.equal(await run(ctx, 'add-agent-to-workspace', 'a1'), 'already added');
  assert.equal(ctx.requests.length, calls);
  await assert.rejects(run(ctx, 'add-agent-to-workspace', 'nope'), /no agent nope on file/);
});

test('chatrooms: created and joined as the agent, recorded on disk', async () => {
  const ctx = registered();
  await run(ctx, 'init-agent', 'pam', '--purpose', 'test pam');
  await assert.rejects(run(ctx, 'create-chatroom', 'main', '--as', 'a1', '--default'), /not in the workspace yet/);
  await run(ctx, 'add-agent-to-workspace', 'a1');

  assert.equal(await run(ctx, 'create-chatroom', 'main', '--as', 'a1', '--default'), 'r1');
  const create = ctx.requests.at(-1)!;
  assert.equal(create.headers!.Authorization, `Bearer ${jwtFor('00000000-0000-0000-0000-000000000001')}`);
  assert.deepEqual(JSON.parse(create.body!), { title: 'main' });
  assert.equal(workspaceOf(ctx).default_chatroom, 'r1');
  assert.deepEqual(workspaceOf(ctx).agents.a1.chatrooms, ['r1']);
  assert.ok(existsSync(agentDir(ctx, 'r1', 'a1')));

  // a second --default creates nothing
  const calls = ctx.requests.length;
  assert.equal(await run(ctx, 'create-chatroom', 'other', '--as', 'a1', '--default'), 'r1');
  assert.equal(ctx.requests.length, calls);

  await run(ctx, 'init-agent', 'oscar', '--purpose', 'test oscar');
  await run(ctx, 'add-agent-to-workspace', 'a2');
  assert.equal(await run(ctx, 'add-agent-to-chatroom', 'r1', 'a2'), 'joined');
  assert.equal(new URL(ctx.requests.at(-1)!.url).pathname, '/@ws123456/rooms/@r1/join');
  assert.equal(await run(ctx, 'add-agent-to-chatroom', 'r1', 'a2'), 'already joined');
  assert.deepEqual(JSON.parse(await run(ctx, 'list-chatrooms'))[0].agents, ['a1', 'a2']);

  await assert.rejects(run(ctx, 'add-agent-to-chatroom', 'nope', 'a2'), /no chatroom nope on file/);
  await assert.rejects(run(ctx, 'remove-agent-from-chatroom', 'r1', 'a2'), /usage:/);
});

test('send-message maps mentioned handles to agent ids and refuses an outsider', async () => {
  const ctx = registered();
  for (const type of ['pam', 'oscar']) await run(ctx, 'init-agent', type, '--purpose', `test ${type}`);
  for (const handle of ['a1', 'a2']) await run(ctx, 'add-agent-to-workspace', handle);
  await run(ctx, 'create-chatroom', 'main', '--as', 'a1', '--default');
  await assert.rejects(run(ctx, 'send-message', 'r1', '--as', 'a2', 'hi'), /is not in chatroom r1/);
  await run(ctx, 'add-agent-to-chatroom', 'r1', 'a2');

  const sent = JSON.parse(await run(ctx, 'send-message', 'r1', '--as', 'a1', 'hello', '--mention', 'a2'));
  assert.deepEqual(sent.mentions, ['00000000-0000-0000-0000-000000000002']);
  assert.equal(JSON.parse(ctx.requests.at(-1)!.body!).text, 'hello');
  await assert.rejects(run(ctx, 'send-message', 'r1', '--as', 'a1', 'x', '--mention', 'ghost'), /no agent ghost on file/);
});

test('the listener stores every message and a copy per mentioned agent; wait-message consumes in order', async () => {
  const ctx = registered();
  for (const type of ['pam', 'oscar']) await run(ctx, 'init-agent', type, '--purpose', `test ${type}`);
  for (const handle of ['a1', 'a2']) await run(ctx, 'add-agent-to-workspace', handle);
  await run(ctx, 'create-chatroom', 'main', '--as', 'a1', '--default');
  await run(ctx, 'add-agent-to-chatroom', 'r1', 'a2');

  const oscarId = '00000000-0000-0000-0000-000000000002';
  const event = (sequence: number, mentions: string[]): SseEvent => ({
    event: 'message',
    id: String(sequence),
    data: JSON.stringify({ id: `m${sequence}`, sequence, text: `t${sequence}`, mentions }),
  });
  ctx.openEventStream = async function* () {
    yield event(1, []);
    yield event(2, [oscarId]);
    yield event(2, [oscarId]); // delivered twice: written once
    yield event(3, [oscarId, 'someone-not-local']);
  };
  await listenOnce(ctx, 'r1', 'a1');

  assert.deepEqual(readdirSync(rawDir(ctx, 'r1')), ['0000000001.json', '0000000002.json', '0000000003.json']);
  assert.deepEqual(readdirSync(agentDir(ctx, 'r1', 'a2')), ['0000000002.json', '0000000003.json']);
  assert.deepEqual(readdirSync(agentDir(ctx, 'r1', 'a1')), []);

  assert.equal(JSON.parse(await run(ctx, 'wait-message', 'r1', '--as', 'a2', '--timeout', '0')).sequence, 2);
  assert.ok(ctx.notes.some((note) => /no listener was running.*started one/.test(note)));
  assert.equal(JSON.parse(await run(ctx, 'wait-message', 'r1', '--as', 'a2', '--timeout', '0')).sequence, 3);
  const empty = await workspaceCommand(ctx, ['wait-message', 'r1', '--as', 'a2', '--timeout', '0']);
  assert.deepEqual(empty, { stdout: 'nothing yet\n', exitCode: NOTHING_YET });
  assert.equal(readFileSync(join(agentDir(ctx, 'r1', 'a2'), '.cursor'), 'utf8'), '3\n');
  await workspaceCommand(ctx, ['stop-listening', 'r1'], '/no/such/entry.ts');
});

test('delete-agent removes the record and the cached token', async () => {
  const ctx = registered();
  await run(ctx, 'init-agent', 'oscar', '--purpose', 'test oscar');
  assert.equal(await run(ctx, 'delete-agent', 'a1'), 'deleted');
  assert.equal(new URL(ctx.requests.at(-1)!.url).pathname, '/~/@a1/delete');
  assert.equal(workspaceOf(ctx).agents.a1, undefined);
  assert.equal(ctx.secrets.get('pile.ly.agent_token/a1'), undefined);
});

test('an expired agent token is re-issued with the owner login', async () => {
  const ctx = registered();
  await run(ctx, 'init-agent', 'pam', '--purpose', 'test pam');
  await run(ctx, 'add-agent-to-workspace', 'a1');
  ctx.secrets.set('pile.ly.agent_token/a1', `${ctx.now().getTime() + 1000}:OLD`);
  await run(ctx, 'create-chatroom', 'main', '--as', 'a1');
  assert.deepEqual(paths(ctx).slice(-2), ['/@a1/issue_id_token', '/@ws123456/rooms/new']);
});

test('parseEventStream: split chunks, heartbeats, multi-line data', async () => {
  async function* chunks() {
    yield ': ping\n\nid: 7\nevent: mess';
    yield 'age\ndata: {"a":1}\n\ndata: x\ndata: y\n\n';
  }
  const events: SseEvent[] = [];
  for await (const event of parseEventStream(chunks())) events.push(event);
  assert.deepEqual(events, [{ id: '7', event: 'message', data: '{"a":1}' }, { data: 'x\ny' }]);
});

test('init-agent deletes the agent again when its token cannot be issued', async () => {
  const ctx = registered();
  const respond = platform();
  ctx.http = async (request) => {
    ctx.requests.push(request);
    return request.url.endsWith('/issue_id_token') ? json(503, { ok: false }) : respond(request);
  };
  await assert.rejects(run(ctx, 'init-agent', 'pam', '--purpose', 'test pam'), /unable to issue an ID token/);
  assert.equal(paths(ctx).at(-1), '/~/@a1/delete');
  assert.equal(workspaceOf(ctx).agents, undefined);
});

test('list-chatrooms ignores stray entries in the chatrooms folder', async () => {
  const ctx = registered();
  mkdirSync(ctx.config.chatroomsDir, { recursive: true });
  writeFileSync(join(ctx.config.chatroomsDir, '.DS_Store'), '');
  assert.deepEqual(JSON.parse(await run(ctx, 'list-chatrooms')), []);
});

test('concurrent updates to workspace.json are not lost', async () => {
  const ctx = registered();
  await Promise.all(Array.from({ length: 8 }, () => run(ctx, 'init-agent', 'oscar', '--purpose', 'test oscar')));
  assert.equal(Object.keys(workspaceOf(ctx).agents).length, 8);
  assert.ok(!existsSync(`${ctx.config.workspaceFile}.lock`));
});

test('a pass that ends early backs off; a healthy one resets the delay', () => {
  assert.equal(nextRetryDelay(0, 10), 2_000);
  assert.equal(nextRetryDelay(2_000, 10), 4_000);
  assert.equal(nextRetryDelay(40_000, 10), 60_000);
  assert.equal(nextRetryDelay(60_000, 3_600_000), 2_000);
});

test('the listener expiry: one hour by default, pushed out by every message', async () => {
  assert.equal(loadConfig({}).listenerExpiryMs, 60 * 60 * 1000);
  assert.equal(loadConfig({ PILELY_LISTENER_EXPIRY_SECS: '5' }).listenerExpiryMs, 5_000);

  let expired = 0;
  const expiry = createExpiry(60, () => void expired++);
  for (let i = 0; i < 4; i++) {
    await sleep(30);
    expiry.touch(); // a message arrived
  }
  assert.equal(expired, 0, 'kept alive well past the original deadline');
  await sleep(120);
  assert.equal(expired, 1, 'expires once the messages stop');
});

test('listenOnce reports each message, so it can extend the lifetime', async () => {
  const ctx = registered();
  await run(ctx, 'init-agent', 'pam', '--purpose', 'test pam');
  await run(ctx, 'add-agent-to-workspace', 'a1');
  await run(ctx, 'create-chatroom', 'main', '--as', 'a1', '--default');
  ctx.openEventStream = async function* () {
    yield { event: 'message', data: JSON.stringify({ sequence: 1, mentions: [] }) };
    yield { event: 'other', data: '{}' };
    yield { event: 'message', data: JSON.stringify({ sequence: 2, mentions: [] }) };
  };
  let messages = 0;
  await listenOnce(ctx, 'r1', 'a1', () => void messages++);
  assert.equal(messages, 2);
});

test('initialize-pam sets everything up, prints nothing, and a second run creates nothing', async () => {
  const ctx = registered();
  // No real process in a test: the listener's entry point is a file that does not exist.
  assert.equal(await run(ctx, 'initialize-pam'), '');
  const workspace = workspaceOf(ctx);
  assert.equal(workspace.default_chatroom, 'r1');
  assert.deepEqual(workspace.agents.a1, { ...workspace.agents.a1, type: 'pam', in_workspace: true, chatrooms: ['r1'] });

  // the state is read back through the tool, not from what initialize-pam printed
  assert.equal(JSON.parse(await run(ctx, 'list-agents', '--type', 'pam', '--json'))[0].handle, 'a1');
  const rooms = JSON.parse(await run(ctx, 'list-chatrooms'));
  // a1 is pam, a2 is dwight: both are in the main chatroom
  assert.deepEqual([rooms[0].room_nanoid, rooms[0].is_default, rooms[0].agents], ['r1', true, ['a1', 'a2']]);
  assert.equal(workspace.agents.a2.type, 'dwight');
  assert.deepEqual(workspace.agents.a2.chatrooms, ['r1']);

  const created = paths(ctx).filter((path) => path === '/~/new_agent' || path.endsWith('/rooms/new')).length;
  assert.equal(await run(ctx, 'initialize-pam'), '');
  assert.equal(paths(ctx).filter((path) => path === '/~/new_agent' || path.endsWith('/rooms/new')).length, created);
  await workspaceCommand(ctx, ['stop-listening', 'r1'], '/no/such/entry.ts');
});

/** A workspace with pam (a1), dwight (a2) and the main room r1, as initialize-pam leaves it. */
async function initialized() {
  const ctx = registered();
  await run(ctx, 'initialize-pam');
  await workspaceCommand(ctx, ['stop-listening', 'r1'], '/no/such/entry.ts');
  return ctx;
}
const platformSlots = new WeakMap<TestContext, Map<string, string>>();

function registeredWithSlots(): TestContext {
  const respond = platform();
  const ctx = testContext(respond);
  writeAccountEmail(ctx, EMAIL);
  ctx.secrets.set(`pile.ly/${EMAIL}`, 'LOGIN.JWT');
  writeWorkspaceFile(ctx, { workspace_nanoid: 'ws123456', owner_email: EMAIL, created_time_stamp: 1 });
  platformSlots.set(ctx, respond.slots);
  return ctx;
}

test('liveness rule: waiting is fresh for 3 minutes, working for 30', () => {
  const now = new Date('2026-09-17T20:15:00Z');
  const beat = (state: Heartbeat['state'], secondsAgo: number): Heartbeat => ({
    state, at: new Date(now.getTime() - secondsAgo * 1000).toISOString(), chatroom: 'r1', host: 'h', pid: 1,
  });
  assert.equal(isHeartbeatFresh(beat('waiting', 170), now), true);
  assert.equal(isHeartbeatFresh(beat('waiting', 190), now), false);
  assert.equal(isHeartbeatFresh(beat('working', 1700), now), true);
  assert.equal(isHeartbeatFresh(beat('working', 1900), now), false);
  assert.equal(isHeartbeatFresh(undefined, now), false);
});

test('wait-message writes the heartbeat and is_alive; agent-status reads the verdict', async () => {
  const ctx = registeredWithSlots();
  await run(ctx, 'initialize-pam');
  await workspaceCommand(ctx, ['stop-listening', 'r1'], '/no/such/entry.ts');
  assert.equal((await workspaceCommand(ctx, ['agent-status', 'a1'])).exitCode, NOT_RUNNING);

  await workspaceCommand(ctx, ['wait-message', 'r1', '--as', 'a1', '--timeout', '0'], '/no/such/entry.ts');
  const beat = JSON.parse(platformSlots.get(ctx)!.get('a1/heartbeat')!);
  assert.equal(beat.state, 'waiting');
  assert.equal(beat.chatroom, 'r1');
  assert.equal(beat.pid, process.pid);
  assert.equal(platformSlots.get(ctx)!.get('a1/is-alive'), 'true');

  const status = await workspaceCommand(ctx, ['agent-status', 'a1']);
  assert.equal(status.exitCode, 0);
  assert.match(status.stdout, /^running\n/);
  assert.equal(JSON.parse(status.stdout.split('\n').slice(1).join('\n')).heartbeat.state, 'waiting');
  assert.equal(JSON.parse(await run(ctx, 'list-agents', '--type', 'pam', '--json'))[0].status, 'running');

  // a message flips the beat to working
  await run(ctx, 'send-message', 'r1', '--as', 'a2', 'hi', '--mention', 'a1');
  writeFileSync(join(agentDir(ctx, 'r1', 'a1'), '0000000001.json'), JSON.stringify({ sequence: 1, text: 'hi', mentions: [] }));
  await workspaceCommand(ctx, ['wait-message', 'r1', '--as', 'a1', '--timeout', '0'], '/no/such/entry.ts');
  assert.equal(JSON.parse(platformSlots.get(ctx)!.get('a1/heartbeat')!).state, 'working');
  await workspaceCommand(ctx, ['stop-listening', 'r1'], '/no/such/entry.ts');
});

test('a second live waiter on the same handle is refused', async () => {
  const ctx = registeredWithSlots();
  await run(ctx, 'initialize-pam');
  platformSlots.get(ctx)!.set('a1/heartbeat', JSON.stringify({ state: 'waiting', at: ctx.now().toISOString(), chatroom: 'r1', host: 'elsewhere', pid: 1 }));
  await assert.rejects(
    workspaceCommand(ctx, ['wait-message', 'r1', '--as', 'a1', '--timeout', '0'], '/no/such/entry.ts'),
    /another process is already waiting as a1 \(elsewhere, pid 1\)/,
  );
  await workspaceCommand(ctx, ['stop-listening', 'r1'], '/no/such/entry.ts');
});

test('create-chatroom joins pam and dwight to every new room', async () => {
  const ctx = await initialized();
  await run(ctx, 'init-agent', 'oscar', '--purpose', 'test oscar');
  await run(ctx, 'add-agent-to-workspace', 'a3');
  assert.equal(await run(ctx, 'create-chatroom', 'side', '--as', 'a3'), 'r2');
  const side = JSON.parse(await run(ctx, 'list-chatrooms')).find((r: { room_nanoid: string }) => r.room_nanoid === 'r2');
  assert.deepEqual(side.agents.sort(), ['a1', 'a2', 'a3']);
});

test('parseMonitorRequest', () => {
  assert.deepEqual(parseMonitorRequest('monitor abc123'), { action: 'monitor', handle: 'abc123' });
  assert.deepEqual(parseMonitorRequest('  Monitor  Xy9  '), { action: 'monitor', handle: 'Xy9' });
  assert.deepEqual(parseMonitorRequest('unmonitor abc'), { action: 'unmonitor', handle: 'abc' });
  assert.equal(parseMonitorRequest('please monitor abc'), undefined);
  assert.equal(parseMonitorRequest('monitor'), undefined);
});

test('dwight-run: a monitor request adds a watch; a stale heartbeat marks the agent dead', async () => {
  const ctx = registeredWithSlots();
  await run(ctx, 'initialize-pam');
  await workspaceCommand(ctx, ['stop-listening', 'r1'], '/no/such/entry.ts');
  const slots = platformSlots.get(ctx)!;
  await run(ctx, 'init-agent', 'oscar', '--purpose', 'test oscar'); // a3
  await run(ctx, 'add-agent-to-workspace', 'a3');
  await run(ctx, 'add-agent-to-chatroom', 'r1', 'a3');
  slots.set('a3/is-alive', 'true');
  slots.set('a3/heartbeat', JSON.stringify({ state: 'waiting', at: ctx.now().toISOString(), chatroom: 'r1', host: 'h', pid: 9 }));

  // a "monitor a3" message from pam, as the listener would have stored it for dwight
  writeFileSync(join(agentDir(ctx, 'r1', 'a2'), '0000000001.json'), JSON.stringify({ sequence: 1, text: 'monitor a3', sender_handle: 'a1', mentions: [] }));
  writeFileSync(join(agentDir(ctx, 'r1', 'a2'), '0000000002.json'), JSON.stringify({ sequence: 2, text: 'hello dwight', sender_handle: 'a1', mentions: [] }));
  await dwightRun(ctx, 'r1', 'a2', '/no/such/entry.ts', { maxTurns: 1, pollMs: 1 });
  assert.deepEqual(JSON.parse(slots.get('a2/watch-list')!), { handles: ['a3'] });
  // dwight reports himself running, like any other agent
  assert.equal(slots.get('a2/is-alive'), 'true');
  assert.equal((await workspaceCommand(ctx, ['agent-status', 'a2'])).exitCode, 0);
  assert.equal(JSON.parse(slots.get('a2/heartbeat')!).state, 'waiting');
  assert.equal(slots.get('a3/is-alive'), 'true'); // fresh: untouched

  // the heartbeat goes stale
  slots.set('a3/heartbeat', JSON.stringify({ state: 'waiting', at: '2026-09-17T19:00:00Z', chatroom: 'r1', host: 'h', pid: 9 }));
  assert.deepEqual(await sweepWatchList(ctx, 'a2', ['a3']), []);
  assert.equal(slots.get('a3/is-alive'), 'false');
  assert.deepEqual(JSON.parse(slots.get('a2/watch-list')!), { handles: [] });
  assert.equal((await workspaceCommand(ctx, ['agent-status', 'a3'])).exitCode, NOT_RUNNING);

  // already dead: dropped without another write
  slots.set('a2/watch-list', JSON.stringify({ handles: ['a3'] }));
  const writes = ctx.requests.length;
  assert.deepEqual(await sweepWatchList(ctx, 'a2', ['a3']), []);
  assert.equal(slots.get('a3/is-alive'), 'false');
  assert.ok(ctx.requests.length - writes <= 2, 'one read of is_alive, one watch-list write');

  await workspaceCommand(ctx, ['stop-listening', 'r1'], '/no/such/entry.ts');
  await assert.rejects(dwightRun(ctx, 'r1', 'a3', '/no/such/entry.ts', { maxTurns: 1 }), /is not a dwight agent/);
});

test('agent-heartbeat writes the given state', async () => {
  const ctx = registeredWithSlots();
  await run(ctx, 'initialize-pam');
  await workspaceCommand(ctx, ['stop-listening', 'r1'], '/no/such/entry.ts');
  assert.equal(await run(ctx, 'agent-heartbeat', 'r1', '--as', 'a1'), '');
  assert.equal(JSON.parse(platformSlots.get(ctx)!.get('a1/heartbeat')!).state, 'working');
  await run(ctx, 'agent-heartbeat', 'r1', '--as', 'a1', '--state', 'waiting');
  assert.equal(JSON.parse(platformSlots.get(ctx)!.get('a1/heartbeat')!).state, 'waiting');
  await assert.rejects(run(ctx, 'agent-heartbeat', 'r1', '--as', 'a1', '--state', 'dead'), /usage:/);
});

test('a second dwight-run on one chatroom refuses', async () => {
  const ctx = registeredWithSlots();
  await run(ctx, 'initialize-pam');
  await workspaceCommand(ctx, ['stop-listening', 'r1'], '/no/such/entry.ts');
  // this process is not itself a dwight-run, so a pid file naming a live but
  // unrelated process is treated as stale and taken over
  writeFileSync(join(roomDir(ctx, 'r1'), 'dwight.pid'), `${process.pid + 100000}\n`);
  await dwightRun(ctx, 'r1', 'a2', '/no/such/entry.ts', { maxTurns: 1, pollMs: 1 });
  assert.equal(readFileSync(join(roomDir(ctx, 'r1'), 'dwight.pid'), 'utf8').trim(), String(process.pid));
  await workspaceCommand(ctx, ['stop-listening', 'r1'], '/no/such/entry.ts');
});

test('init-agent writes the profile slot on the platform: type, purpose, created_by', async () => {
  const ctx = registeredWithSlots();
  await run(ctx, 'init-agent', 'oscar', '--purpose', 'answers billing questions');
  assert.deepEqual(JSON.parse(platformSlots.get(ctx)!.get('a1/profile')!), {
    type: 'oscar',
    purpose: 'answers billing questions',
    created_by: EMAIL,
  });
});

test('initialize-pam gives pam and dwight fixed purposes', async () => {
  const ctx = await initialized();
  const agents = JSON.parse(await run(ctx, 'list-agents', '--json'));
  assert.match(agents.find((a: { type: string }) => a.type === 'pam').purpose, /speaks for the user/);
  assert.match(agents.find((a: { type: string }) => a.type === 'dwight').purpose, /watches which agents/);
});

test('an agent is in one chatroom only; pam and dwight are in all of them', async () => {
  const ctx = await initialized();
  await run(ctx, 'init-agent', 'oscar', '--purpose', 'test oscar'); // a3
  await run(ctx, 'add-agent-to-workspace', 'a3');
  await run(ctx, 'add-agent-to-chatroom', 'r1', 'a3');
  assert.equal(await run(ctx, 'create-chatroom', 'side', '--as', 'a1'), 'r2'); // pam creates; dwight auto-joins
  await assert.rejects(run(ctx, 'add-agent-to-chatroom', 'r2', 'a3'), /already in chatroom r1; an agent is in one chatroom only/);
  assert.deepEqual(workspaceOf(ctx).agents.a3.chatrooms, ['r1']);
  assert.deepEqual(workspaceOf(ctx).agents.a1.chatrooms.sort(), ['r1', 'r2']);
  assert.deepEqual(workspaceOf(ctx).agents.a2.chatrooms.sort(), ['r1', 'r2']);
});

test('list-agents: one line per agent, scoped to a chatroom when one is given', async () => {
  const ctx = await initialized();
  await run(ctx, 'init-agent', 'oscar', '--purpose', 'answers billing questions'); // a3
  await run(ctx, 'add-agent-to-workspace', 'a3');
  await run(ctx, 'create-chatroom', 'side', '--as', 'a1'); // r2
  await run(ctx, 'add-agent-to-chatroom', 'r2', 'a3');

  const all = (await run(ctx, 'list-agents')).split('\n');
  assert.equal(all.length, 3);
  assert.match(all[2]!, /^a3\s+oscar\s+not running\s+answers billing questions$/);

  const main = (await run(ctx, 'list-agents', 'r1')).split('\n');
  assert.deepEqual(main.map((l) => l.split(/\s+/)[0]), ['a1', 'a2']);
  const side = JSON.parse(await run(ctx, 'list-agents', 'r2', '--json')).map((a: { handle: string }) => a.handle);
  assert.deepEqual(side.sort(), ['a1', 'a2', 'a3']);
  await assert.rejects(run(ctx, 'list-agents', 'nope'), /no chatroom nope on file/);
  await assert.rejects(run(ctx, 'list-agents', 'r1', 'r2'), /usage:/);
});

test('delete-agent tells Dwight to stop watching, as pam, in the agent\'s room', async () => {
  const ctx = await initialized();
  await run(ctx, 'init-agent', 'oscar', '--purpose', 'test oscar'); // a3
  await run(ctx, 'add-agent-to-workspace', 'a3');
  await run(ctx, 'add-agent-to-chatroom', 'r1', 'a3');
  assert.equal(await run(ctx, 'delete-agent', 'a3'), 'deleted');
  const sent = ctx.requests.filter((r) => r.url.endsWith('/rooms/@r1/messages/send')).map((r) => JSON.parse(r.body!));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, 'unmonitor a3');
  assert.deepEqual(sent[0].mentions, ['00000000-0000-0000-0000-000000000002']); // dwight's id
});

test('dwight-run: unmonitor drops the handle without a verdict', async () => {
  const ctx = registeredWithSlots();
  await run(ctx, 'initialize-pam');
  await workspaceCommand(ctx, ['stop-listening', 'r1'], '/no/such/entry.ts');
  const slots = platformSlots.get(ctx)!;
  await run(ctx, 'init-agent', 'oscar', '--purpose', 'test oscar'); // a3
  await run(ctx, 'add-agent-to-workspace', 'a3');
  await run(ctx, 'add-agent-to-chatroom', 'r1', 'a3');
  slots.set('a3/is-alive', 'true');
  slots.set('a2/watch-list', JSON.stringify({ handles: ['a3'] }));
  writeFileSync(join(agentDir(ctx, 'r1', 'a2'), '0000000001.json'), JSON.stringify({ sequence: 1, text: 'unmonitor a3', sender_handle: 'a1', mentions: [] }));
  await dwightRun(ctx, 'r1', 'a2', '/no/such/entry.ts', { maxTurns: 1, pollMs: 1 });
  assert.deepEqual(JSON.parse(slots.get('a2/watch-list')!), { handles: [] });
  assert.equal(slots.get('a3/is-alive'), 'true');
  await workspaceCommand(ctx, ['stop-listening', 'r1'], '/no/such/entry.ts');
});

test('artifacts: put writes a snapshot filed under the room, get returns the newest, list shows one per name', async () => {
  const ctx = await initialized();
  const file = join(ctx.dir, 'idea.md');
  writeFileSync(file, '# idea v1\n');
  const id1 = await run(ctx, 'artifact', 'put', 'r1', 'app_idea', '--as', 'a1', '--file', file);
  assert.equal(id1, 'art1');
  const created = JSON.parse(ctx.requests.find((r) => r.url.endsWith('/artifacts/new'))!.body!);
  assert.equal(created.name, 'r1/app_idea');
  assert.equal(created.content, '# idea v1\n');
  assert.equal(readFileSync(join(roomDir(ctx, 'r1'), 'artifacts', 'app_idea.md'), 'utf8'), '# idea v1\n');

  writeFileSync(file, '# idea v2\n');
  assert.equal(await run(ctx, 'artifact', 'put', 'r1', 'app_idea', '--as', 'a1', '--file', file), 'art2');
  assert.equal(await run(ctx, 'artifact', 'get', 'r1', 'app_idea'), '# idea v2');
  assert.equal(await run(ctx, 'artifact', 'get', 'r1', 'app_idea', '--version', 'art1'), '# idea v1');
  assert.equal(readFileSync(join(roomDir(ctx, 'r1'), 'artifacts', 'app_idea.md'), 'utf8'), '# idea v2\n');

  writeFileSync(file, 'plan\n');
  await run(ctx, 'artifact', 'put', 'r1', 'build_plan', '--as', 'a1', '--file', file);
  const listed = (await run(ctx, 'artifact', 'list', 'r1')).split('\n');
  assert.deepEqual(listed.map((l) => l.split(/\s+/)[0]), ['build_plan', 'app_idea']);
  assert.match(listed[1]!, /^app_idea\s+art2\s+a1\s+10 bytes/);
  const history = (await run(ctx, 'artifact', 'list', 'r1', '--history', 'app_idea')).split('\n');
  assert.deepEqual(history.map((l) => l.split(/\s+/)[1]), ['art2', 'art1']);
});

test('artifacts: names are per chatroom, and errors are clear', async () => {
  const ctx = await initialized();
  await run(ctx, 'create-chatroom', 'side', '--as', 'a1'); // r2
  const file = join(ctx.dir, 'x.md');
  writeFileSync(file, 'room one\n');
  await run(ctx, 'artifact', 'put', 'r1', 'app_idea', '--as', 'a1', '--file', file);
  await assert.rejects(run(ctx, 'artifact', 'get', 'r2', 'app_idea'), /no artifact app_idea in chatroom r2/);
  assert.equal(await run(ctx, 'artifact', 'list', 'r2'), '');
  await assert.rejects(run(ctx, 'artifact', 'put', 'r1', 'bad name', '--as', 'a1', '--file', file), /not an artifact name/);
  await assert.rejects(run(ctx, 'artifact', 'put', 'r1', 'app_idea', '--file', file), /usage:/);
  await assert.rejects(run(ctx, 'artifact', 'get', 'nope', 'app_idea'), /no chatroom nope on file/);
  writeFileSync(file, '');
  await assert.rejects(run(ctx, 'artifact', 'put', 'r1', 'app_idea', '--as', 'a1', '--file', file), /content is empty/);
});
