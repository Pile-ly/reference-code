// dwight-run — the whole of Dwight's job, in one call that never returns
// on its own:
//
//   pilely workspace dwight-run <chatroom> --as <handle>
//
// Forever:
//   - a message for Dwight saying `monitor <handle>` puts that handle on
//     his watch list (kept in his own private state, so a restarted Dwight
//     carries on with the same list); `unmonitor <handle>` takes it off
//     again without a verdict — what delete-agent sends;
//   - a watched agent whose heartbeat has gone stale is marked dead
//     (is_alive = false) and dropped from the list;
//   - Dwight's own heartbeat is refreshed every minute.
// One line per event goes to stdout. The call ends only when the harness
// ends it, and Dwight then simply runs it again.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { readState, writeOwnState } from '../agent_state.ts';
import { nextMessageFor, readRoom, roomDir, writeCursor } from '../chatroom_files.ts';
import type { Context } from '../context.ts';
import { CliError, ok } from '../errors.ts';
import type { CommandResult } from '../errors.ts';
import { parseJsonObject, stringField } from '../http.ts';
import {
  HEARTBEAT_INTERVAL_MS,
  heartbeatNow,
  isHeartbeatFresh,
  markAlive,
  markDead,
  readAlive,
  readHeartbeat,
  writeHeartbeat,
} from '../liveness.ts';
import { requireAgent, requireWorkspaceFile } from '../workspace_file.ts';
import { startListener } from './listener.ts';

export const WATCH_LIST_SLOT = 'watch-list';
const PID_FILE = 'dwight.pid';
const MESSAGE_POLL_MS = 2_000;
const HEARTBEAT_CHECK_MS = 30_000;

export interface DwightOptions {
  /** Stop after this many loop turns; tests only. */
  maxTurns?: number;
  /** Sleep between turns; tests shorten it. */
  pollMs?: number;
}

/** `monitor <handle>` or `unmonitor <handle>` — the two requests Dwight understands. */
export function parseMonitorRequest(text: string): { action: 'monitor' | 'unmonitor'; handle: string } | undefined {
  const match = text.trim().match(/^(monitor|unmonitor)\s+([A-Za-z0-9]{1,16})\s*$/i);
  return match ? { action: match[1]!.toLowerCase() as 'monitor' | 'unmonitor', handle: match[2]! } : undefined;
}

async function readWatchList(ctx: Context, dwight: string): Promise<string[]> {
  const slot = await readState(ctx, dwight, WATCH_LIST_SLOT);
  const json = slot ? parseJsonObject(slot.content) : undefined;
  return Array.isArray(json?.handles) ? json.handles.filter((h): h is string => typeof h === 'string') : [];
}

async function writeWatchList(ctx: Context, dwight: string, handles: string[]): Promise<void> {
  await writeOwnState(ctx, dwight, WATCH_LIST_SLOT, JSON.stringify({ handles }));
}

/** One pass over the watch list: every stale agent is marked dead and dropped. */
export async function sweepWatchList(ctx: Context, dwight: string, watched: string[]): Promise<string[]> {
  const kept: string[] = [];
  for (const handle of watched) {
    let dead: boolean;
    try {
      // An agent already marked dead is dropped without a word; one with a
      // fresh heartbeat is fine; anything else has stopped beating.
      if ((await readAlive(ctx, handle)) === false) continue;
      dead = !isHeartbeatFresh(await readHeartbeat(ctx, handle), ctx.now());
    } catch (error) {
      ctx.note(`could not check ${handle}: ${error instanceof Error ? error.message : String(error)}`);
      kept.push(handle);
      continue;
    }
    if (dead) {
      await markDead(ctx, handle);
      process.stdout.write(`${ctx.now().toISOString()} ${handle} stopped; marked dead\n`);
    } else {
      kept.push(handle);
    }
  }
  if (kept.length !== watched.length) await writeWatchList(ctx, dwight, kept);
  return kept;
}

/**
 * True only when `pid` is a dwight-run for this room. A pid file outlives a
 * crash and the system reuses pids, so the file alone proves nothing.
 */
function anotherDwightIsRunning(ctx: Context, room: string): number | undefined {
  const file = join(roomDir(ctx, room), PID_FILE);
  if (!existsSync(file)) return undefined;
  const pid = Number(readFileSync(file, 'utf8').trim());
  if (Number.isInteger(pid) && pid > 0 && pid !== process.pid) {
    try {
      const command = execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
      if (command.includes('dwight-run') && command.includes(room)) return pid;
    } catch {
      // the process is gone
    }
  }
  rmSync(file, { force: true });
  return undefined;
}

export async function dwightRun(
  ctx: Context,
  room: string,
  dwight: string,
  entryPoint: string,
  options: DwightOptions = {},
): Promise<CommandResult> {
  readRoom(ctx, room);
  const record = requireAgent(requireWorkspaceFile(ctx), dwight);
  if (record.type !== 'dwight') throw new CliError(`${dwight} is not a dwight agent`);
  if (!record.chatrooms.includes(room)) {
    throw new CliError(`agent ${dwight} is not in chatroom ${room} (run pilely workspace add-agent-to-chatroom ${room} ${dwight})`);
  }
  // Two of these would sweep one watch list and race each other's writes.
  const other = anotherDwightIsRunning(ctx, room);
  if (other !== undefined) {
    throw new CliError(`another dwight-run is already watching chatroom ${room} (pid ${other})`);
  }
  const pidPath = join(roomDir(ctx, room), PID_FILE);
  writeFileSync(pidPath, `${process.pid}\n`);
  const release = () => {
    if (existsSync(pidPath) && Number(readFileSync(pidPath, 'utf8').trim()) === process.pid) {
      rmSync(pidPath, { force: true });
    }
  };
  process.on('exit', release);
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => process.exit(0));

  if (startListener(ctx, room, dwight, entryPoint) === 'started') ctx.note(`started the listener for chatroom ${room}`);

  // Dwight is an agent like any other: he reports himself running, so
  // whoever launched him can see that he is.
  await markAlive(ctx, dwight);

  let watched = await readWatchList(ctx, dwight);
  process.stdout.write(`${ctx.now().toISOString()} dwight ${dwight} running; watching ${watched.length} agent(s)\n`);
  let lastBeat = 0;
  let lastSweep = 0;
  const pollMs = options.pollMs ?? MESSAGE_POLL_MS;

  for (let turn = 0; options.maxTurns === undefined || turn < options.maxTurns; turn++) {
    const now = Date.now();
    if (now - lastBeat >= HEARTBEAT_INTERVAL_MS) {
      try {
        await writeHeartbeat(ctx, dwight, heartbeatNow(ctx, 'waiting', room));
      } catch (error) {
        ctx.note(`heartbeat not written: ${error instanceof Error ? error.message : String(error)}`);
      }
      lastBeat = now;
    }

    // Every message addressed to Dwight, in order.
    for (let next = nextMessageFor(ctx, room, dwight); next; next = nextMessageFor(ctx, room, dwight)) {
      writeCursor(ctx, room, dwight, next.sequence);
      const message = parseJsonObject(next.content);
      const request = parseMonitorRequest(stringField(message, 'text') ?? '');
      const sender = stringField(message, 'sender_handle') ?? '?';
      if (!request) {
        process.stdout.write(`${ctx.now().toISOString()} ignored a message from ${sender} that is not "monitor <handle>" or "unmonitor <handle>"\n`);
        continue;
      }
      const { action, handle } = request;
      if (action === 'unmonitor') {
        // Taken out on purpose: drop it without a verdict.
        if (watched.includes(handle)) {
          watched = watched.filter((h) => h !== handle);
          await writeWatchList(ctx, dwight, watched);
        }
        process.stdout.write(`${ctx.now().toISOString()} no longer watching ${handle} (asked by ${sender})\n`);
        continue;
      }
      if (!requireWorkspaceFile(ctx).agents?.[handle]) {
        process.stdout.write(`${ctx.now().toISOString()} ${sender} asked to monitor ${handle}, which is not on file; ignored\n`);
        continue;
      }
      if (!watched.includes(handle)) {
        watched = [...watched, handle];
        await writeWatchList(ctx, dwight, watched);
      }
      process.stdout.write(`${ctx.now().toISOString()} watching ${handle} (asked by ${sender})\n`);
    }

    if (now - lastSweep >= HEARTBEAT_CHECK_MS) {
      watched = await sweepWatchList(ctx, dwight, watched);
      lastSweep = now;
    }
    await sleep(pollMs);
  }
  return ok();
}
