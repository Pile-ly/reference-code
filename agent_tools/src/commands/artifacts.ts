// Artifacts: the documents a chatroom's agents share, without asking
// anyone. On the platform an artifact is immutable and workspace-wide, so
// the tool files each one under its room (`<room>/<name>`) and treats the
// newest with a name as "the" document: put writes a new snapshot, get
// prints the newest.
//
//   artifact put  <chatroom> <name> --as <handle> [--file <path>]   (else stdin)
//   artifact get  <chatroom> <name> [--version <id>]
//   artifact list <chatroom> [--history <name>]
//
// get and put also leave the content at
// .pilely/chatrooms/<room>/artifacts/<name>.md for an agent's file tool.

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentTokenFor } from '../agent_token.ts';
import { readRoom, roomDir } from '../chatroom_files.ts';
import type { Context } from '../context.ts';
import { CliError, ok } from '../errors.ts';
import type { CommandResult } from '../errors.ts';
import { writeFileAtomically } from '../files.ts';
import { isSuccess } from '../http.ts';
import { asAgent, objectField } from '../workspace_api.ts';
import { requireAgent, requireWorkspaceFile } from '../workspace_file.ts';

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export interface ArtifactRow {
  id: string;
  name: string;
  created_by_handle: string;
  byte_size: number;
  created_time_stamp: unknown;
}

function requireName(name: string): string {
  if (!NAME.test(name)) throw new CliError(`not an artifact name: ${name} (letters, digits, _ . -)`);
  return name;
}

const scoped = (room: string, name: string) => `${room}/${name}`;
const localCopy = (ctx: Context, room: string, name: string) => join(roomDir(ctx, room), 'artifacts', `${name}.md`);

/** Any agent in the workspace will do for a read; Pam's is preferred as the one always there. */
function anyReader(ctx: Context): string {
  const agents = Object.entries(requireWorkspaceFile(ctx).agents ?? {}).filter(([, a]) => a.in_workspace);
  const pam = agents.find(([, a]) => a.type === 'pam');
  const first = (pam ?? agents[0])?.[0];
  if (!first) throw new CliError('no agent in this workspace to read as (run pilely workspace initialize-pam)');
  return first;
}

/** Every artifact filed under this room, newest first. */
async function listRoom(ctx: Context, room: string, reader: string): Promise<ArtifactRow[]> {
  const prefix = `${room}/`;
  const rows: ArtifactRow[] = [];
  let cursor: string | undefined;
  do {
    const page = await asAgent(ctx, reader, 'list artifacts', '/artifacts/list', cursor ? { cursor, limit: 100 } : { limit: 100 });
    const artifacts = Array.isArray(page.artifacts) ? (page.artifacts as Record<string, unknown>[]) : [];
    for (const a of artifacts) {
      const name = typeof a.name === 'string' ? a.name : '';
      if (!name.startsWith(prefix)) continue;
      rows.push({
        id: String(a.id),
        name: name.slice(prefix.length),
        created_by_handle: String(a.created_by_handle ?? ''),
        byte_size: Number(a.byte_size) || 0,
        created_time_stamp: a.created_time_stamp,
      });
    }
    cursor = typeof page.next_cursor === 'string' ? page.next_cursor : undefined;
  } while (cursor);
  return rows;
}

async function readContent(ctx: Context, reader: string, id: string): Promise<string> {
  const workspace = requireWorkspaceFile(ctx);
  const token = await agentTokenFor(ctx, reader, workspace.app_id!);
  const response = await ctx.http({
    method: 'POST',
    url: `${ctx.config.workspaceBaseUrl}/@${workspace.workspace_nanoid}/artifacts/@${id}/read`,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!isSuccess(response.status)) throw new CliError(`read artifact ${id} failed (http ${response.status}): ${response.body}`);
  return response.body;
}

async function put(ctx: Context, room: string, name: string, handle: string, file: string | undefined): Promise<CommandResult> {
  readRoom(ctx, room);
  requireName(name);
  if (!requireAgent(requireWorkspaceFile(ctx), handle).chatrooms.includes(room)) {
    throw new CliError(`agent ${handle} is not in chatroom ${room}`);
  }
  const content = file === undefined ? readFileSync(0, 'utf8') : readFileSync(file, 'utf8');
  if (content.length === 0) throw new CliError('nothing to put: the content is empty');
  const created = objectField(
    await asAgent(ctx, handle, 'put artifact', '/artifacts/new', {
      name: scoped(room, name),
      media_type: 'text/markdown; charset=utf-8',
      content,
    }),
    'artifact',
  );
  const id = typeof created.id === 'string' ? created.id : undefined;
  if (!id) throw new CliError('put artifact response carried no id');
  writeFileAtomically(localCopy(ctx, room, name), content);
  return ok(`${id}\n`);
}

async function get(ctx: Context, room: string, name: string, version: string | undefined): Promise<CommandResult> {
  readRoom(ctx, room);
  requireName(name);
  const reader = anyReader(ctx);
  let id = version;
  if (!id) {
    const newest = (await listRoom(ctx, room, reader)).find((row) => row.name === name);
    if (!newest) throw new CliError(`no artifact ${name} in chatroom ${room}`);
    id = newest.id;
  }
  const content = await readContent(ctx, reader, id);
  if (!version) writeFileAtomically(localCopy(ctx, room, name), content);
  return ok(content);
}

async function list(ctx: Context, room: string, history: string | undefined): Promise<CommandResult> {
  readRoom(ctx, room);
  const rows = await listRoom(ctx, room, anyReader(ctx));
  const shown = history ? rows.filter((r) => r.name === requireName(history)) : dedupeNewest(rows);
  if (shown.length === 0) return ok();
  const w = (k: 'name' | 'id' | 'created_by_handle') => Math.max(...shown.map((r) => r[k].length));
  const lines = shown.map(
    (r) => `${r.name.padEnd(w('name'))}  ${r.id.padEnd(w('id'))}  ${r.created_by_handle.padEnd(w('created_by_handle'))}  ${r.byte_size} bytes  ${String(r.created_time_stamp ?? '')}`,
  );
  return ok(`${lines.join('\n')}\n`);
}

/** Rows come newest first, so the first of each name is the current one. */
function dedupeNewest(rows: ArtifactRow[]): ArtifactRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => (seen.has(r.name) ? false : (seen.add(r.name), true)));
}

export async function artifactsCommand(ctx: Context, args: string[]): Promise<CommandResult> {
  const [sub, room, ...rest] = args;
  const usage = `usage: pilely workspace artifact {put <chatroom> <name> --as <handle> [--file <path>] | get <chatroom> <name> [--version <id>] | list <chatroom> [--history <name>]}`;
  if (!room) throw new CliError(usage);
  switch (sub) {
    case 'put': {
      const [name, ...flags] = rest;
      let handle: string | undefined;
      let file: string | undefined;
      for (let i = 0; i < flags.length; i++) {
        if (flags[i] === '--as') handle = flags[++i];
        else if (flags[i] === '--file') file = flags[++i];
        else throw new CliError(usage);
      }
      if (!name || !handle) throw new CliError(usage);
      mkdirSync(join(roomDir(ctx, room), 'artifacts'), { recursive: true });
      return put(ctx, room, name, handle, file);
    }
    case 'get': {
      const [name, flag, version, ...extra] = rest;
      if (!name || extra.length || (flag !== undefined && (flag !== '--version' || !version))) throw new CliError(usage);
      return get(ctx, room, name, version);
    }
    case 'list': {
      const [flag, history, ...extra] = rest;
      if (extra.length || (flag !== undefined && (flag !== '--history' || !history))) throw new CliError(usage);
      return list(ctx, room, history);
    }
    default:
      throw new CliError(usage);
  }
}
