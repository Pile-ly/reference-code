// The chatroom listener: one detached process per room that holds the
// room's live stream open and writes every message it receives under
// ./.pilely/chatrooms/<room>/ (layout in ../chatroom_files.ts).
//
//   listen-chatroom <room> --as <handle>   start it (no-op when one is running)
//   listen-status <room>
//   stop-listening <room>
//   run-listener <room> --as <handle>      the process itself; started by listen-chatroom
//
// A listener is never stopped by the session that started it — a session
// can end without a word. Instead it expires: it exits one hour after the
// last message it received (or after it started, if none came), and every
// new message pushes that out again. The next `listen-chatroom` or
// `initialize-pam` starts a fresh one.
//
// The stream carries only what is sent while it is connected: nothing is
// replayed, and a message sent while no listener is connected is never
// written here. The platform ends every stream within the hour and a
// stream ticket works once, so the process loops: subscribe, connect, read
// until the stream ends, subscribe again.

import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { logFile, pidFile, rawDir, readRoom, roomDir, storeMessage } from '../chatroom_files.ts';
import type { Context } from '../context.ts';
import { CliError, ok } from '../errors.ts';
import type { CommandResult } from '../errors.ts';
import { parseJsonObject, stringField } from '../http.ts';
import { asAgent } from '../workspace_api.ts';
import { requireAgent, requireWorkspaceFile } from '../workspace_file.ts';

// A pass that ends sooner than this did not really connect (refused
// ticket, removed agent, dead network): wait before the next one, doubling
// up to the cap, so a broken room is retried gently instead of hammered.
const HEALTHY_PASS_MS = 30_000;
const MIN_RETRY_MS = 2_000;
const MAX_RETRY_MS = 60_000;

export function nextRetryDelay(previousDelayMs: number, passLastedMs: number): number {
  if (passLastedMs >= HEALTHY_PASS_MS) return MIN_RETRY_MS;
  return Math.min(Math.max(previousDelayMs * 2, MIN_RETRY_MS), MAX_RETRY_MS);
}

/**
 * True only when `pid` is a listener for this room. A pid file outlives a
 * crash, and the system hands old pids to new processes — so "a process
 * with that pid exists" is not enough to report it running, and never
 * enough to send it a signal.
 */
function isListenerProcess(pid: number, room: string): boolean {
  try {
    const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    return command.includes('run-listener') && command.includes(room);
  } catch {
    return false;
  }
}

function runningPid(ctx: Context, room: string): number | undefined {
  const file = pidFile(ctx, room);
  if (!existsSync(file)) return undefined;
  const pid = Number(readFileSync(file, 'utf8').trim());
  if (Number.isInteger(pid) && pid > 0 && isListenerProcess(pid, room)) return pid;
  rmSync(file, { force: true });
  return undefined;
}

function requireListenable(ctx: Context, room: string, handle: string): void {
  readRoom(ctx, room);
  if (!requireAgent(requireWorkspaceFile(ctx), handle).chatrooms.includes(room)) {
    throw new CliError(`agent ${handle} is not in chatroom ${room} (run pilely workspace add-agent-to-chatroom ${room} ${handle})`);
  }
}

export function startListener(ctx: Context, room: string, handle: string, entryPoint: string): 'started' | 'already running' {
  requireListenable(ctx, room, handle);
  if (runningPid(ctx, room)) return 'already running';
  mkdirSync(roomDir(ctx, room), { recursive: true });
  // Claim the pid file before starting anything: of two callers racing to
  // start a listener, exactly one creates the file and the other backs off.
  let claim: number;
  try {
    claim = openSync(pidFile(ctx, room), 'wx');
  } catch {
    return 'already running';
  }
  try {
    const log = openSync(logFile(ctx, room), 'a');
    const child = spawn(process.execPath, [entryPoint, 'workspace', 'run-listener', room, '--as', handle], {
      detached: true,
      stdio: ['ignore', log, log],
      cwd: process.cwd(),
      env: process.env,
    });
    closeSync(log);
    if (!child.pid) throw new CliError('unable to start the listener process');
    writeFileSync(claim, `${child.pid}\n`);
    child.unref();
    return 'started';
  } catch (error) {
    rmSync(pidFile(ctx, room), { force: true });
    throw error;
  } finally {
    closeSync(claim);
  }
}

function lastSequence(ctx: Context, room: string): number {
  const dir = rawDir(ctx, room);
  if (!existsSync(dir)) return 0;
  return readdirSync(dir).reduce((max, name) => Math.max(max, Number(name.slice(0, 10)) || 0), 0);
}

function listenStatus(ctx: Context, room: string): CommandResult {
  readRoom(ctx, room);
  const pid = runningPid(ctx, room);
  return ok(`${JSON.stringify({ running: pid !== undefined, pid: pid ?? null, last_sequence: lastSequence(ctx, room) }, null, 2)}\n`);
}

function stopListening(ctx: Context, room: string): CommandResult {
  readRoom(ctx, room);
  const pid = runningPid(ctx, room);
  if (!pid) return ok('not running\n');
  process.kill(pid, 'SIGTERM');
  rmSync(pidFile(ctx, room), { force: true });
  return ok('stopped\n');
}

/** A deadline that every `touch()` pushes out again; `onExpire` runs once it passes untouched. */
export function createExpiry(afterMs: number, onExpire: () => void): { touch: () => void; stop: () => void } {
  let timer: NodeJS.Timeout | undefined;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(onExpire, afterMs);
  };
  touch();
  return { touch, stop: () => clearTimeout(timer) };
}

/** Removes the pid file, but only when it still names this process — never a newer listener's. */
function releasePidFile(ctx: Context, room: string): void {
  const file = pidFile(ctx, room);
  if (existsSync(file) && Number(readFileSync(file, 'utf8').trim()) === process.pid) rmSync(file, { force: true });
}

/** One subscribe-and-read pass. Returns when the platform ends the stream. */
export async function listenOnce(ctx: Context, room: string, handle: string, onMessage: () => void = () => {}): Promise<void> {
  const subscribed = await asAgent(ctx, handle, 'subscribe to chatroom', `/rooms/@${room}/messages/subscribe`);
  const url = stringField(subscribed, 'url');
  if (!url) throw new CliError('subscribe response carried no stream url');
  ctx.note(`connected to chatroom ${room}`);
  for await (const event of ctx.openEventStream(url)) {
    if (event.event !== 'message') continue;
    const message = parseJsonObject(event.data);
    if (!message) continue;
    onMessage();
    // Re-read per message: an agent added after the listener started is still served.
    const agents = Object.entries(requireWorkspaceFile(ctx).agents ?? {});
    storeMessage(ctx, room, message, new Map(agents.map(([agentHandle, agent]) => [agent.agent_id, agentHandle])));
  }
  ctx.note(`stream for chatroom ${room} ended`);
}

async function runListener(ctx: Context, room: string, handle: string): Promise<CommandResult> {
  requireListenable(ctx, room, handle);
  const stamped: Context = { ...ctx, note: (line) => process.stderr.write(`${new Date().toISOString()} ${line}\n`) };
  const exit = (reason: string) => {
    stamped.note(`listener for chatroom ${room} stopped: ${reason}`);
    releasePidFile(ctx, room);
    process.exit(0);
  };
  const seconds = Math.round(ctx.config.listenerExpiryMs / 1000);
  const quiet = seconds >= 120 ? `${Math.round(seconds / 60)} minutes` : `${seconds} seconds`;
  const expiry = createExpiry(ctx.config.listenerExpiryMs, () => exit(`expired, no message for ${quiet}`));
  process.on('SIGTERM', () => exit('stop requested'));
  process.on('SIGINT', () => exit('stop requested'));

  let delay = 0;
  for (;;) {
    const started = Date.now();
    try {
      await listenOnce(stamped, room, handle, expiry.touch);
    } catch (error) {
      stamped.note(`listener error: ${error instanceof Error ? error.message : String(error)}`);
    }
    delay = nextRetryDelay(delay, Date.now() - started);
    await sleep(delay);
  }
}

function roomAndHandle(args: string[], usage: string): [string, string] {
  if (args.length !== 3 || args[1] !== '--as') throw new CliError(`usage: pilely workspace ${usage}`);
  return [args[0]!, args[2]!];
}

export async function listenerCommand(
  ctx: Context,
  command: string,
  args: string[],
  entryPoint: string,
): Promise<CommandResult | undefined> {
  switch (command) {
    case 'listen-chatroom': {
      const [room, handle] = roomAndHandle(args, 'listen-chatroom <room> --as <handle>');
      return ok(`${startListener(ctx, room, handle, entryPoint)}\n`);
    }
    case 'run-listener': {
      const [room, handle] = roomAndHandle(args, 'run-listener <room> --as <handle>');
      return runListener(ctx, room, handle);
    }
    case 'listen-status':
      if (args.length !== 1) throw new CliError('usage: pilely workspace listen-status <room>');
      return listenStatus(ctx, args[0]!);
    case 'stop-listening':
      if (args.length !== 1) throw new CliError('usage: pilely workspace stop-listening <room>');
      return stopListening(ctx, args[0]!);
    default:
      return undefined;
  }
}
