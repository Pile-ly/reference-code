// pilely workspace — binds the session's working directory to one
// @simple_workspace workspace.
//
//   pilely workspace register
//   pilely workspace info
//   pilely workspace guide-version <skill version>
//
// register creates a workspace owned by the logged-in account and writes
// it to ./.pilely/workspace.json. When that file already names a
// workspace, register creates nothing and reports the existing one.
//
// info prints the workspace on file, without any network call.
//
// guide-version records which version of the agent guides this folder was
// set up with, in ./.pilely/pam_version.md, and prints one word:
// `recorded` (no file before), `unchanged` (same version, checked_at
// refreshed) or `changed` (a different version was on file; now replaced).
// No network call.

import { existsSync, readFileSync } from 'node:fs';
import { requireAccountEmail } from '../account.ts';
import type { Context } from '../context.ts';
import { CliError, ok } from '../errors.ts';
import type { CommandResult } from '../errors.ts';
import { writeFileAtomically } from '../files.ts';
import { isSuccess, parseJsonObject, stringField } from '../http.ts';
import { pilelyRequest } from '../pilely_request.ts';
import { readWorkspaceFile, requireWorkspaceFile, writeWorkspaceFile } from '../workspace_file.ts';
import { agentsCommand } from './agents.ts';
import { artifactsCommand } from './artifacts.ts';
import { chatroomsCommand } from './chatrooms.ts';
import { listenerCommand } from './listener.ts';
import { memoryCommand } from './memory.ts';
import { initializePam } from './pam.ts';

const USAGE = `usage: pilely workspace <command>
  register | info | guide-version <skill version>
  initialize-pam
  init-agent <type> --purpose "<line>" | add-agent-to-workspace <handle> | remove-agent-from-workspace <handle>
  delete-agent <handle> | list-agents [<chatroom>] [--type <type>] [--json] | agent-status <handle>
  agent-heartbeat <chatroom> --as <handle> [--state working|waiting]
  create-chatroom <title> --as <handle> [--default] | list-chatrooms
  add-agent-to-chatroom <room> <handle>
  send-message <room> --as <handle> <text> [--mention <handle>]... [--reply-to <message id>]
  list-messages <room> [--limit <n>] [--json]
  listen-chatroom <room> --as <handle> | listen-status <room> | stop-listening <room>
  wait-message <room> --as <handle> [--timeout <seconds>]
  artifact put <room> <name> --as <handle> --text <content> | artifact get <room> <name> [--version <id>]
  artifact list <room> [--history <name>]
  memory get --as <handle> | memory put --as <handle> --text <content>`;

/** `entryPoint` is the bin file, so the listener can start itself as a detached process. */
export async function workspaceCommand(ctx: Context, args: string[], entryPoint = ''): Promise<CommandResult> {
  const [command, ...rest] = args;
  switch (command) {
    case 'register':
      if (rest.length !== 0) throw new CliError(USAGE);
      return register(ctx);
    case 'info':
      if (rest.length !== 0) throw new CliError(USAGE);
      return ok(`${JSON.stringify(requireWorkspaceFile(ctx), null, 2)}\n`);
    case 'guide-version':
      if (rest.length !== 1) throw new CliError(USAGE);
      return guideVersion(ctx, rest[0]!);
    case 'initialize-pam':
      if (rest.length !== 0) throw new CliError(USAGE);
      return initializePam(ctx, entryPoint);
    case 'artifact':
      return artifactsCommand(ctx, rest);
    case 'memory':
      return memoryCommand(ctx, rest);
    case undefined:
      throw new CliError(USAGE);
    default: {
      const result =
        (await agentsCommand(ctx, command, rest)) ??
        (await chatroomsCommand(ctx, command, rest, entryPoint)) ??
        (await listenerCommand(ctx, command, rest, entryPoint));
      if (!result) throw new CliError(USAGE);
      return result;
    }
  }
}

async function register(ctx: Context): Promise<CommandResult> {
  const existing = readWorkspaceFile(ctx);
  if (existing) {
    ctx.note('already registered, nothing created');
    return ok(`${JSON.stringify(existing, null, 2)}\n`);
  }

  const email = requireAccountEmail(ctx);
  const response = await pilelyRequest(ctx, {
    method: 'POST',
    url: `${ctx.config.workspaceBaseUrl}/~/new_workspace`,
    wantJson: true,
  });
  if (!isSuccess(response.status)) {
    throw new CliError(`workspace create failed (http ${response.status}): ${response.body}`);
  }
  const workspace = parseJsonObject(response.body)?.workspace;
  const fields = workspace !== null && typeof workspace === 'object' ? (workspace as Record<string, unknown>) : undefined;
  const nanoid = stringField(fields, 'workspace_nanoid');
  if (!nanoid) {
    throw new CliError(`workspace create response carried no workspace_nanoid: ${response.body}`);
  }

  const created = {
    workspace_nanoid: nanoid,
    owner_email: email,
    // Kept exactly as the service answered it (epoch milliseconds).
    created_time_stamp: fields?.created_time_stamp ?? null,
  };
  writeWorkspaceFile(ctx, created);
  return ok(`${JSON.stringify(created, null, 2)}\n`);
}

function guideVersion(ctx: Context, version: string): CommandResult {
  if (!/^[0-9A-Za-z._-]+$/.test(version)) throw new CliError(`not a skill version: ${version}`);
  const file = ctx.config.guideVersionFile;
  const previous = existsSync(file)
    ? readFileSync(file, 'utf8').match(/^skill_version: (.+)$/m)?.[1]?.trim()
    : undefined;
  const outcome = !previous ? 'recorded' : previous === version ? 'unchanged' : 'changed';

  const checkedAt = ctx.now().toISOString().replace(/\.\d{3}Z$/, 'Z');
  writeFileAtomically(file, `skill_version: ${version}\nchecked_at: ${checkedAt}\n`);
  return ok(`${outcome}\n`);
}
