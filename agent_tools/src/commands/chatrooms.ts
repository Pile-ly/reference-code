// Chatrooms. On the platform a room is created, joined, left and written
// to by an AGENT, never by the workspace owner — so every command here
// that reaches the platform acts as one agent, with that agent's token.
//
//   create-chatroom <title> --as <handle> [--default]
//   add-agent-to-chatroom <room> <handle>       an agent is in ONE chatroom (pam and dwight: all)
//   list-chatrooms                                   local files only
//   send-message <room> --as <handle> <text> [--mention <handle>]... [--reply-to <message id>]
//   wait-message <room> --as <handle> [--timeout <seconds>]   local files only

import { mkdirSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { agentDir, listRooms, nextMessageFor, readRoom, roomFile, writeCursor } from '../chatroom_files.ts';
import type { RoomRecord } from '../chatroom_files.ts';
import type { Context } from '../context.ts';
import { CliError, failed, ok } from '../errors.ts';
import type { CommandResult } from '../errors.ts';
import { writeJsonAtomically } from '../files.ts';
import { stringField } from '../http.ts';
import { asAgent, objectField } from '../workspace_api.ts';
import { requireAgent, requireWorkspaceFile, updateWorkspaceFile } from '../workspace_file.ts';
import { startListener } from './listener.ts';
import {
  HEARTBEAT_INTERVAL_MS,
  heartbeatNow,
  isHeartbeatFresh,
  isOwnHeartbeat,
  markAlive,
  readHeartbeat,
  writeHeartbeat,
} from '../liveness.ts';
import type { HeartbeatState } from '../liveness.ts';

/** Agent types that every chatroom gets, whoever creates it. */
export const ALWAYS_IN_ROOMS = ['pam', 'dwight'];

/** Exit code of wait-message when the timeout passes with nothing new. */
export const NOTHING_YET = 3;

function requireMember(ctx: Context, handle: string): void {
  if (!requireAgent(requireWorkspaceFile(ctx), handle).in_workspace) {
    throw new CliError(`agent ${handle} is not in the workspace yet (run pilely workspace add-agent-to-workspace ${handle})`);
  }
}

function requireInRoom(ctx: Context, room: string, handle: string): void {
  readRoom(ctx, room);
  if (!requireAgent(requireWorkspaceFile(ctx), handle).chatrooms.includes(room)) {
    throw new CliError(`agent ${handle} is not in chatroom ${room} (run pilely workspace add-agent-to-chatroom ${room} ${handle})`);
  }
}

function recordJoined(ctx: Context, room: string, handle: string): void {
  updateWorkspaceFile(ctx, (workspace) => {
    const agent = requireAgent(workspace, handle);
    if (!agent.chatrooms.includes(room)) agent.chatrooms.push(room);
  });
  mkdirSync(agentDir(ctx, room, handle), { recursive: true });
}

export async function createChatroom(ctx: Context, title: string, handle: string, isDefault: boolean): Promise<string> {
  requireMember(ctx, handle);
  const existing = requireWorkspaceFile(ctx).default_chatroom;
  if (isDefault && existing) {
    ctx.note('a default chatroom already exists, nothing created');
    return existing;
  }
  const created = objectField(await asAgent(ctx, handle, 'create chatroom', '/rooms/new', { title }), 'room');
  const room = stringField(created, 'id');
  if (!room) throw new CliError('create chatroom response carried no room id');

  const record: RoomRecord = {
    room_nanoid: room,
    title,
    created_by: handle,
    is_default: isDefault,
    created_time_stamp: created.created_time_stamp ?? null,
  };
  writeJsonAtomically(roomFile(ctx, room), record);
  if (isDefault) updateWorkspaceFile(ctx, (workspace) => void (workspace.default_chatroom = room));
  // The platform joins a room's creator to it.
  recordJoined(ctx, room, handle);
  // Pam and Dwight are in every chatroom: Pam speaks for the user, Dwight
  // watches the agents in it.
  for (const [member, agent] of Object.entries(requireWorkspaceFile(ctx).agents ?? {})) {
    if (ALWAYS_IN_ROOMS.includes(agent.type) && agent.in_workspace && member !== handle) {
      await addAgentToChatroom(ctx, room, member);
    }
  }
  return room;
}

export async function addAgentToChatroom(ctx: Context, room: string, handle: string): Promise<'joined' | 'already joined'> {
  readRoom(ctx, room);
  requireMember(ctx, handle);
  const agent = requireAgent(requireWorkspaceFile(ctx), handle);
  if (agent.chatrooms.includes(room)) return 'already joined';
  // A chatroom is a task and an agent belongs to its task. Only Pam and
  // Dwight, who serve the whole workspace, are in every room.
  if (agent.chatrooms.length > 0 && !ALWAYS_IN_ROOMS.includes(agent.type)) {
    throw new CliError(`agent ${handle} is already in chatroom ${agent.chatrooms[0]}; an agent is in one chatroom only`);
  }
  await asAgent(ctx, handle, 'join chatroom', `/rooms/@${room}/join`);
  recordJoined(ctx, room, handle);
  return 'joined';
}

function listChatrooms(ctx: Context): CommandResult {
  const agents = Object.entries(requireWorkspaceFile(ctx).agents ?? {});
  const rooms = listRooms(ctx).map((room) => ({
    ...room,
    agents: agents.filter(([, agent]) => agent.chatrooms.includes(room.room_nanoid)).map(([handle]) => handle),
  }));
  return ok(`${JSON.stringify(rooms, null, 2)}\n`);
}

interface SendOptions {
  room: string;
  handle: string;
  text: string;
  mentions: string[];
  replyTo?: string;
}

async function sendMessage(ctx: Context, options: SendOptions): Promise<CommandResult> {
  requireInRoom(ctx, options.room, options.handle);
  const workspace = requireWorkspaceFile(ctx);
  const body: Record<string, unknown> = {
    text: options.text,
    mentions: options.mentions.map((mentioned) => requireAgent(workspace, mentioned).agent_id),
  };
  if (options.replyTo) body.reply_to = options.replyTo;
  const sent = await asAgent(ctx, options.handle, 'send message', `/rooms/@${options.room}/messages/send`, body);
  return ok(`${JSON.stringify(objectField(sent, 'message'), null, 2)}\n`);
}

async function waitMessage(ctx: Context, room: string, handle: string, timeoutSecs: number, entryPoint: string): Promise<CommandResult> {
  requireInRoom(ctx, room, handle);
  // Waiting without a listener would wait for nothing: a listener expires,
  // and a crash or a reboot ends one. Bringing it back is the tool's job,
  // not something an agent has to remember.
  if (startListener(ctx, room, handle, entryPoint) === 'started') {
    ctx.note(`no listener was running for chatroom ${room}; started one`);
  }
  await refuseSecondWaiter(ctx, handle);
  await beat(ctx, handle, 'waiting', room, true);

  const deadline = Date.now() + timeoutSecs * 1000;
  let lastBeat = Date.now();
  for (;;) {
    const next = nextMessageFor(ctx, room, handle);
    if (next) {
      writeCursor(ctx, room, handle, next.sequence);
      await beat(ctx, handle, 'working', room);
      return ok(next.content);
    }
    if (Date.now() >= deadline) return failed('nothing yet\n', NOTHING_YET);
    if (Date.now() - lastBeat >= HEARTBEAT_INTERVAL_MS) {
      await beat(ctx, handle, 'waiting', room);
      lastBeat = Date.now();
    }
    await sleep(500);
  }
}

/**
 * Writes the heartbeat (and, at the start of a wait, the is_alive verdict).
 * A failed write is a note, never a failure: losing the network must not
 * stop an agent from waiting on what the listener already saved.
 */
async function beat(ctx: Context, handle: string, state: HeartbeatState, room: string, alive = false): Promise<void> {
  try {
    await writeHeartbeat(ctx, handle, heartbeatNow(ctx, state, room));
    if (alive) await markAlive(ctx, handle);
  } catch (error) {
    ctx.note(`heartbeat not written: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Two processes waiting as one handle would each consume half the messages. */
async function refuseSecondWaiter(ctx: Context, handle: string): Promise<void> {
  let current;
  try {
    current = await readHeartbeat(ctx, handle);
  } catch {
    return;
  }
  if (current?.state === 'waiting' && isHeartbeatFresh(current, ctx.now()) && !isOwnHeartbeat(current)) {
    throw new CliError(`another process is already waiting as ${handle} (${current.host}, pid ${current.pid})`);
  }
}

/** Splits `--flag value` pairs (repeatable) from positional arguments. */
function parseFlags(args: string[], flags: string[], switches: string[] = []) {
  const positional: string[] = [];
  const values: Record<string, string[]> = {};
  const on = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (switches.includes(arg)) on.add(arg);
    else if (flags.includes(arg)) {
      const value = args[++i];
      if (value === undefined) throw new CliError(`${arg} needs a value`);
      (values[arg] ??= []).push(value);
    } else positional.push(arg);
  }
  return { positional, values, on };
}

export async function chatroomsCommand(
  ctx: Context,
  command: string,
  args: string[],
  entryPoint: string,
): Promise<CommandResult | undefined> {
  switch (command) {
    case 'create-chatroom': {
      const { positional, values, on } = parseFlags(args, ['--as'], ['--default']);
      const handle = values['--as']?.[0];
      if (positional.length !== 1 || !handle) {
        throw new CliError('usage: pilely workspace create-chatroom <title> --as <handle> [--default]');
      }
      return ok(`${await createChatroom(ctx, positional[0]!, handle, on.has('--default'))}\n`);
    }
    case 'add-agent-to-chatroom':
      if (args.length !== 2) throw new CliError('usage: pilely workspace add-agent-to-chatroom <room> <handle>');
      return ok(`${await addAgentToChatroom(ctx, args[0]!, args[1]!)}\n`);
    case 'list-chatrooms':
      if (args.length !== 0) throw new CliError('usage: pilely workspace list-chatrooms');
      return listChatrooms(ctx);
    case 'send-message': {
      const { positional, values } = parseFlags(args, ['--as', '--mention', '--reply-to']);
      const handle = values['--as']?.[0];
      if (positional.length !== 2 || !handle) {
        throw new CliError(
          'usage: pilely workspace send-message <room> --as <handle> <text> [--mention <handle>]... [--reply-to <message id>]',
        );
      }
      return sendMessage(ctx, {
        room: positional[0]!,
        handle,
        text: positional[1]!,
        mentions: values['--mention'] ?? [],
        replyTo: values['--reply-to']?.[0],
      });
    }
    case 'wait-message': {
      const { positional, values } = parseFlags(args, ['--as', '--timeout']);
      const handle = values['--as']?.[0];
      const timeout = Number(values['--timeout']?.[0] ?? 600);
      if (positional.length !== 1 || !handle || !Number.isFinite(timeout) || timeout < 0) {
        throw new CliError('usage: pilely workspace wait-message <room> --as <handle> [--timeout <seconds>]');
      }
      return waitMessage(ctx, positional[0]!, handle, timeout, entryPoint);
    }
    default:
      return undefined;
  }
}
