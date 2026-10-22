// Everything a chatroom keeps on disk, under ./.pilely/chatrooms/<room>/:
//
//   room.json                     what create-chatroom recorded
//   listener.pid, listener.log    only while / after a listener runs
//   raw_messages/<sequence>.json  every message the listener received
//   agent_<handle>/<sequence>.json  a copy of each message that mentions that agent
//   agent_<handle>/.cursor          the highest sequence that agent has consumed
//
// Files are named by the message's per-room sequence (zero-padded), so
// order is a directory listing and a message received twice lands once.

import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Context } from './context.ts';
import { CliError } from './errors.ts';
import { writeFileAtomically } from './files.ts';
import { parseJsonObject } from './http.ts';

export interface RoomRecord {
  room_nanoid: string;
  title: string;
  created_by: string;
  is_default: boolean;
  created_time_stamp: unknown;
}

const ROOM_NANOID = /^[0-9A-Za-z_-]{1,32}$/;

export function requireRoomNanoid(room: string): string {
  if (!ROOM_NANOID.test(room)) throw new CliError(`not a chatroom id: ${room}`);
  return room;
}

export const roomDir = (ctx: Context, room: string) => join(ctx.config.chatroomsDir, requireRoomNanoid(room));
export const roomFile = (ctx: Context, room: string) => join(roomDir(ctx, room), 'room.json');
export const pidFile = (ctx: Context, room: string) => join(roomDir(ctx, room), 'listener.pid');
export const logFile = (ctx: Context, room: string) => join(roomDir(ctx, room), 'listener.log');
export const rawDir = (ctx: Context, room: string) => join(roomDir(ctx, room), 'raw_messages');
export const agentDir = (ctx: Context, room: string, handle: string) => join(roomDir(ctx, room), `agent_${handle}`);

export function readRoom(ctx: Context, room: string): RoomRecord {
  const file = roomFile(ctx, room);
  if (!existsSync(file)) throw new CliError(`no chatroom ${room} on file (run pilely workspace list-chatrooms)`);
  return parseJsonObject(readFileSync(file, 'utf8')) as unknown as RoomRecord;
}

export function listRooms(ctx: Context): RoomRecord[] {
  if (!existsSync(ctx.config.chatroomsDir)) return [];
  return readdirSync(ctx.config.chatroomsDir)
    .filter((room) => ROOM_NANOID.test(room) && existsSync(roomFile(ctx, room)))
    .map((room) => readRoom(ctx, room));
}

export const sequenceFileName = (sequence: number) => `${String(sequence).padStart(10, '0')}.json`;

/** Writes one received message, plus a copy for every local agent it mentions. */
export function storeMessage(ctx: Context, room: string, message: Record<string, unknown>, handlesById: Map<string, string>): void {
  const sequence = Number(message.sequence);
  if (!Number.isInteger(sequence) || sequence < 1) return;
  const name = sequenceFileName(sequence);
  const content = `${JSON.stringify(message, null, 2)}\n`;
  if (!existsSync(join(rawDir(ctx, room), name))) writeFileAtomically(join(rawDir(ctx, room), name), content);

  const mentions = Array.isArray(message.mentions) ? message.mentions : [];
  for (const agentId of mentions) {
    const handle = handlesById.get(String(agentId));
    if (!handle) continue;
    const copy = join(agentDir(ctx, room, handle), name);
    if (!existsSync(copy)) writeFileAtomically(copy, content);
  }
}

export function readCursor(ctx: Context, room: string, handle: string): number {
  const file = join(agentDir(ctx, room, handle), '.cursor');
  return existsSync(file) ? Number(readFileSync(file, 'utf8').trim()) || 0 : 0;
}

export function writeCursor(ctx: Context, room: string, handle: string, sequence: number): void {
  writeFileAtomically(join(agentDir(ctx, room, handle), '.cursor'), `${sequence}\n`);
}

/** The oldest message for this agent above its cursor, if any. */
export function nextMessageFor(ctx: Context, room: string, handle: string): { sequence: number; content: string } | undefined {
  const dir = agentDir(ctx, room, handle);
  mkdirSync(dir, { recursive: true });
  const cursor = readCursor(ctx, room, handle);
  const next = readdirSync(dir)
    .filter((name) => /^\d{10}\.json$/.test(name))
    .map((name) => ({ name, sequence: Number(name.slice(0, 10)) }))
    .filter((entry) => entry.sequence > cursor)
    .sort((a, b) => a.sequence - b.sequence)[0];
  return next ? { sequence: next.sequence, content: readFileSync(join(dir, next.name), 'utf8') } : undefined;
}
