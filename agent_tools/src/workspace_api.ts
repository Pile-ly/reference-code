// Calls to @simple_workspace. Two callers exist: the workspace owner (the
// user's app token, through pilelyRequest) and a member agent (its own ID
// token). Rooms, messages and the stream accept only the agent.

import { agentTokenFor } from './agent_token.ts';
import type { Context } from './context.ts';
import { CliError } from './errors.ts';
import { isSuccess, parseJsonObject } from './http.ts';
import { pilelyRequest } from './pilely_request.ts';
import { requireAgent, requireWorkspaceFile } from './workspace_file.ts';

type Json = Record<string, unknown>;

function parsed(what: string, status: number, body: string): Json {
  if (!isSuccess(status)) throw new CliError(`${what} failed (http ${status}): ${body}`);
  return parseJsonObject(body) ?? {};
}

export async function asOwner(ctx: Context, what: string, path: string, body: Json = {}): Promise<Json> {
  const workspace = requireWorkspaceFile(ctx);
  const response = await pilelyRequest(ctx, {
    method: 'POST',
    url: `${ctx.config.workspaceBaseUrl}/@${workspace.workspace_nanoid}${path}`,
    jsonBody: JSON.stringify(body),
    wantJson: true,
  });
  return parsed(what, response.status, response.body);
}

export async function asAgent(ctx: Context, handle: string, what: string, path: string, body: Json = {}): Promise<Json> {
  const workspace = requireWorkspaceFile(ctx);
  requireAgent(workspace, handle);
  if (!workspace.app_id) throw new CliError('workspace.json names no app_id; run pilely workspace init-agent first');
  const token = await agentTokenFor(ctx, handle, workspace.app_id);
  const response = await ctx.http({
    method: 'POST',
    url: `${ctx.config.workspaceBaseUrl}/@${workspace.workspace_nanoid}${path}`,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  return parsed(what, response.status, response.body);
}

export function objectField(json: Json, key: string): Json {
  const value = json[key];
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
}
