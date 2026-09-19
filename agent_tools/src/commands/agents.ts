// Agent management. One step per command, so each can be checked and
// retried on its own:
//
//   init-agent <type> --purpose "<line>"    create the agent on the platform
//   add-agent-to-workspace <handle>         make it a member of this workspace
//   remove-agent-from-workspace <handle>
//   delete-agent <handle>                   delete it on the platform (revokes its tokens)
//   list-agents [<chatroom>] [--type <type>] [--json]   one line per agent: handle, type, status, purpose
//   agent-status <handle>                   running / not running
//   agent-heartbeat <chatroom> --as <handle> [--state working|waiting]
//
// <type> is a label ("pam", "oscar"); several agents may share one. The
// handle the platform mints is the identity everywhere else.

import { agentIdFromToken, forgetAgentToken, issueAgentToken } from '../agent_token.ts';
import type { Context } from '../context.ts';
import { CliError, ok } from '../errors.ts';
import type { CommandResult } from '../errors.ts';
import { isSuccess, parseJsonObject, stringField } from '../http.ts';
import { pilelyRequest } from '../pilely_request.ts';
import { asOwner, objectField } from '../workspace_api.ts';
import { requireAgent, requireWorkspaceFile, updateWorkspaceFile } from '../workspace_file.ts';
import { writeOwnState } from '../agent_state.ts';
import { heartbeatNow, readAlive, readHeartbeat, writeHeartbeat } from '../liveness.ts';
import { readRoom } from '../chatroom_files.ts';
import { asAgent } from '../workspace_api.ts';

/** Where an agent's type and purpose live on the platform, for anyone to read. */
export const PROFILE_SLOT = 'profile';
import type { HeartbeatState } from '../liveness.ts';

/** Exit code of agent-status for an agent that is not running. */
export const NOT_RUNNING = 3;

/**
 * The app new agents are bound to: the one on file, else the first app the
 * account owns (then remembered). The platform requires an owned app.
 */
async function resolveAppId(ctx: Context): Promise<string> {
  const onFile = requireWorkspaceFile(ctx).app_id;
  if (onFile) return onFile;
  const response = await pilelyRequest(ctx, {
    method: 'POST',
    url: `${ctx.config.apexBaseUrl}/~/apps/list`,
    jsonBody: '{}',
  });
  if (!isSuccess(response.status)) {
    throw new CliError(`unable to list this account's apps (http ${response.status}): ${response.body}`);
  }
  const piles = parseJsonObject(response.body)?.piles;
  const first = Array.isArray(piles) ? (piles[0] as Record<string, unknown> | undefined) : undefined;
  const appId = stringField(first, 'pile_id');
  if (!appId) {
    throw new CliError(
      'an agent must be bound to an app this account owns, and the account owns none yet; register an app first',
    );
  }
  updateWorkspaceFile(ctx, (workspace) => void (workspace.app_id = appId));
  return appId;
}

export async function initAgent(ctx: Context, type: string, purpose: string): Promise<string> {
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(type)) {
    throw new CliError(`not an agent type: ${type} (lowercase letters, digits, - and _)`);
  }
  purpose = purpose.trim();
  if (purpose.length < 3 || purpose.length > 200 || purpose.includes('\n')) {
    throw new CliError('--purpose must be one line, 3 to 200 characters, saying what this agent is for');
  }
  const appId = await resolveAppId(ctx);
  const response = await pilelyRequest(ctx, {
    method: 'POST',
    url: `${ctx.config.agentBaseUrl}/~/new_agent`,
    jsonBody: JSON.stringify({ app_id: appId }),
    wantJson: true,
  });
  if (!isSuccess(response.status)) {
    throw new CliError(`agent create failed (http ${response.status}): ${response.body}`);
  }
  const handle = stringField(objectField(parseJsonObject(response.body) ?? {}, 'agent'), 'handle');
  if (!handle) throw new CliError(`agent create response carried no handle: ${response.body}`);

  let agentId: string;
  try {
    agentId = agentIdFromToken(await issueAgentToken(ctx, handle, appId));
  } catch (error) {
    // Without its id the agent cannot be recorded or used; do not leave it
    // behind on the platform where nothing here would ever find it again.
    await deleteOnPlatform(ctx, handle).catch(() => undefined);
    forgetAgentToken(ctx, handle);
    throw error;
  }
  const created_by = requireWorkspaceFile(ctx).owner_email;
  updateWorkspaceFile(ctx, (workspace) => {
    workspace.agents = {
      ...workspace.agents,
      [handle]: {
        type,
        purpose,
        agent_id: agentId,
        in_workspace: false,
        chatrooms: [],
        created_time_stamp: ctx.now().toISOString(),
      },
    };
  });
  // On the platform too, so any tool anywhere can read what this agent is.
  await writeOwnState(ctx, handle, PROFILE_SLOT, JSON.stringify({ type, purpose, created_by }));
  return handle;
}

/**
 * Tells Dwight to stop watching an agent that is being taken out on
 * purpose, so he does not first call it dead. Sent as Pam, in every room
 * the agent is in; quietly skipped when there is no Pam or Dwight to use.
 */
async function tellDwightToUnmonitor(ctx: Context, handle: string): Promise<void> {
  const workspace = requireWorkspaceFile(ctx);
  const agents = Object.entries(workspace.agents ?? {});
  const pam = agents.find(([, a]) => a.type === 'pam' && a.in_workspace)?.[0];
  const dwight = agents.find(([, a]) => a.type === 'dwight' && a.in_workspace);
  if (!pam || !dwight) return;
  for (const room of requireAgent(workspace, handle).chatrooms) {
    try {
      await asAgent(ctx, pam, 'tell dwight', `/rooms/@${room}/messages/send`, {
        text: `unmonitor ${handle}`,
        mentions: [dwight[1].agent_id],
      });
    } catch (error) {
      ctx.note(`could not tell Dwight to stop watching ${handle}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export async function addAgentToWorkspace(ctx: Context, handle: string): Promise<'added' | 'already added'> {
  const agent = requireAgent(requireWorkspaceFile(ctx), handle);
  if (agent.in_workspace) return 'already added';
  await asOwner(ctx, 'add agent to workspace', '/agents/add', { agent_id: agent.agent_id });
  updateWorkspaceFile(ctx, (workspace) => void (requireAgent(workspace, handle).in_workspace = true));
  return 'added';
}

async function removeAgentFromWorkspace(ctx: Context, handle: string): Promise<CommandResult> {
  const agent = requireAgent(requireWorkspaceFile(ctx), handle);
  await tellDwightToUnmonitor(ctx, handle);
  await asOwner(ctx, 'remove agent from workspace', '/agents/remove', { agent_id: agent.agent_id });
  updateWorkspaceFile(ctx, (workspace) => {
    const record = requireAgent(workspace, handle);
    record.in_workspace = false;
    // The platform drops the agent's room participation with its membership.
    record.chatrooms = [];
  });
  return ok('removed\n');
}

async function deleteOnPlatform(ctx: Context, handle: string): Promise<void> {
  const response = await pilelyRequest(ctx, {
    method: 'POST',
    url: `${ctx.config.agentBaseUrl}/~/@${handle}/delete`,
    wantJson: true,
  });
  if (!isSuccess(response.status)) {
    throw new CliError(`agent delete failed (http ${response.status}): ${response.body}`);
  }
}

async function deleteAgent(ctx: Context, handle: string): Promise<CommandResult> {
  requireAgent(requireWorkspaceFile(ctx), handle);
  await tellDwightToUnmonitor(ctx, handle);
  await deleteOnPlatform(ctx, handle);
  forgetAgentToken(ctx, handle);
  updateWorkspaceFile(ctx, (workspace) => {
    delete workspace.agents?.[handle];
  });
  return ok('deleted\n');
}

interface ListOptions {
  room?: string;
  type?: string;
  json: boolean;
}

async function listAgents(ctx: Context, options: ListOptions): Promise<CommandResult> {
  if (options.room) readRoom(ctx, options.room);
  const agents = await Promise.all(
    Object.entries(requireWorkspaceFile(ctx).agents ?? {})
      .filter(([, agent]) => !options.type || agent.type === options.type)
      .filter(([, agent]) => !options.room || agent.chatrooms.includes(options.room))
      .map(async ([handle, agent]) => ({
        handle,
        status: (await readAlive(ctx, handle)) ? 'running' : 'not running',
        ...agent,
      })),
  );
  if (options.json) return ok(`${JSON.stringify(agents, null, 2)}\n`);
  // One line each, columns padded so the eye can scan them.
  const width = (key: 'handle' | 'type' | 'status') => Math.max(...agents.map((a) => a[key].length), 0);
  const lines = agents.map(
    (a) => `${a.handle.padEnd(width('handle'))}  ${a.type.padEnd(width('type'))}  ${a.status.padEnd(width('status'))}  ${a.purpose}`,
  );
  return ok(lines.length ? `${lines.join('\n')}\n` : '');
}

async function agentStatus(ctx: Context, handle: string): Promise<CommandResult> {
  requireAgent(requireWorkspaceFile(ctx), handle);
  const alive = (await readAlive(ctx, handle)) === true;
  const heartbeat = (await readHeartbeat(ctx, handle)) ?? null;
  const body = `${alive ? 'running' : 'not running'}\n${JSON.stringify({ handle, running: alive, heartbeat }, null, 2)}\n`;
  return { stdout: body, exitCode: alive ? 0 : NOT_RUNNING };
}

async function agentHeartbeat(ctx: Context, room: string, handle: string, state: HeartbeatState): Promise<CommandResult> {
  requireAgent(requireWorkspaceFile(ctx), handle);
  await writeHeartbeat(ctx, handle, heartbeatNow(ctx, state, room));
  return ok();
}

export async function agentsCommand(ctx: Context, command: string, args: string[]): Promise<CommandResult | undefined> {
  const one = (usage: string): string => {
    if (args.length !== 1) throw new CliError(`usage: pilely workspace ${usage}`);
    return args[0]!;
  };
  switch (command) {
    case 'init-agent': {
      const usage = 'usage: pilely workspace init-agent <type> --purpose "<what this agent is for>"';
      const [type, flag, purpose, ...rest] = args;
      if (!type || flag !== '--purpose' || purpose === undefined || rest.length) throw new CliError(usage);
      return ok(`${await initAgent(ctx, type, purpose)}\n`);
    }
    case 'add-agent-to-workspace':
      return ok(`${await addAgentToWorkspace(ctx, one('add-agent-to-workspace <handle>'))}\n`);
    case 'remove-agent-from-workspace':
      return removeAgentFromWorkspace(ctx, one('remove-agent-from-workspace <handle>'));
    case 'delete-agent':
      return deleteAgent(ctx, one('delete-agent <handle>'));
    case 'list-agents': {
      const usage = 'usage: pilely workspace list-agents [<chatroom>] [--type <type>] [--json]';
      const options: ListOptions = { json: false };
      for (let i = 0; i < args.length; i++) {
        const arg = args[i]!;
        if (arg === '--json') options.json = true;
        else if (arg === '--type') {
          options.type = args[++i];
          if (!options.type) throw new CliError(usage);
        } else if (!arg.startsWith('--') && options.room === undefined) options.room = arg;
        else throw new CliError(usage);
      }
      return listAgents(ctx, options);
    }
    case 'agent-status':
      return agentStatus(ctx, one('agent-status <handle>'));
    case 'agent-heartbeat': {
      const usage = 'usage: pilely workspace agent-heartbeat <chatroom> --as <handle> [--state working|waiting]';
      const [room, asFlag, handle, ...rest] = args;
      const state = rest.length === 0 ? 'working' : rest.length === 2 && rest[0] === '--state' ? rest[1] : undefined;
      if (!room || asFlag !== '--as' || !handle || (state !== 'working' && state !== 'waiting')) throw new CliError(usage);
      return agentHeartbeat(ctx, room, handle, state);
    }
    default:
      return undefined;
  }
}
