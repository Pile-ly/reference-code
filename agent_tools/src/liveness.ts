// Whether an agent is running, read from one slot of its private state:
//
//   heartbeat  { state: "waiting" | "working", at, chatroom, host, pid }
//              — written by the agent's own wait-message (and
//              agent-heartbeat during long work). A `waiting` beat is
//              refreshed every minute; a `working` one only when the agent
//              says so, hence the two windows below.
//
// An agent is running exactly when its heartbeat is fresh. Nobody watches
// and nobody records a verdict: whoever asks reads the beat and applies the
// one rule, `isHeartbeatFresh`.

import { hostname } from 'node:os';
import { readState, writeOwnState } from './agent_state.ts';
import type { Context } from './context.ts';
import { parseJsonObject, stringField } from './http.ts';

export const HEARTBEAT_SLOT = 'heartbeat';

export const WAITING_FRESH_MS = 3 * 60_000;
export const WORKING_FRESH_MS = 30 * 60_000;
/** How often a blocked wait-message refreshes its `waiting` beat. */
export const HEARTBEAT_INTERVAL_MS = 60_000;

export type HeartbeatState = 'waiting' | 'working';

export interface Heartbeat {
  state: HeartbeatState;
  at: string;
  chatroom: string;
  host: string;
  pid: number;
}

export function heartbeatNow(ctx: Context, state: HeartbeatState, chatroom: string): Heartbeat {
  return { state, at: ctx.now().toISOString(), chatroom, host: hostname(), pid: process.pid };
}

export async function writeHeartbeat(ctx: Context, handle: string, beat: Heartbeat): Promise<void> {
  await writeOwnState(ctx, handle, HEARTBEAT_SLOT, JSON.stringify(beat));
}

export async function readHeartbeat(ctx: Context, handle: string): Promise<Heartbeat | undefined> {
  const slot = await readState(ctx, handle, HEARTBEAT_SLOT);
  const json = slot ? parseJsonObject(slot.content) : undefined;
  const state = stringField(json, 'state');
  const at = stringField(json, 'at');
  if (!json || (state !== 'waiting' && state !== 'working') || !at) return undefined;
  return {
    state,
    at,
    chatroom: stringField(json, 'chatroom') ?? '',
    host: stringField(json, 'host') ?? '',
    pid: typeof json.pid === 'number' ? json.pid : 0,
  };
}

/** The one liveness rule. */
export function isHeartbeatFresh(beat: Heartbeat | undefined, now: Date): boolean {
  if (!beat) return false;
  const age = now.getTime() - Date.parse(beat.at);
  if (!Number.isFinite(age)) return false;
  return age < (beat.state === 'working' ? WORKING_FRESH_MS : WAITING_FRESH_MS);
}

/** True when this process is the one named by the beat. */
export function isOwnHeartbeat(beat: Heartbeat): boolean {
  return beat.host === hostname() && beat.pid === process.pid;
}

/** True when the agent's heartbeat is fresh. */
export async function isRunning(ctx: Context, handle: string): Promise<boolean> {
  return isHeartbeatFresh(await readHeartbeat(ctx, handle), ctx.now());
}
