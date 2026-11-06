// One agent's private state on @simple_agent: a few named text slots.
//
//   heartbeat   written by the agent while it waits or works
//   profile     what the agent is: type, purpose, who created it
//   memory      the agent's own notes between launches
//
// Writes go out as the agent itself. Reads go out as the owner, so any tool
// on this machine can read any agent's slot.

import { agentTokenFor } from './agent_token.ts';
import type { Context } from './context.ts';
import { CliError } from './errors.ts';
import { isSuccess, parseJsonObject, stringField } from './http.ts';
import { pilelyRequest } from './pilely_request.ts';
import { requireWorkspaceFile } from './workspace_file.ts';

export interface StateSlot {
  content: string;
  updatedAt: string;
}

function stateUrl(ctx: Context, handle: string, identifier: string, action: 'read' | 'replace'): string {
  return `${ctx.config.agentBaseUrl}/@${handle}/states/${identifier}/${action}`;
}

/** The slot, or undefined when it was never written. */
export async function readState(ctx: Context, handle: string, identifier: string): Promise<StateSlot | undefined> {
  const response = await pilelyRequest(ctx, {
    method: 'POST',
    url: stateUrl(ctx, handle, identifier, 'read'),
    jsonBody: '{}',
    wantJson: true,
  });
  if (response.status === 404) return undefined;
  if (!isSuccess(response.status)) {
    throw new CliError(`unable to read state ${identifier} of agent ${handle} (http ${response.status}): ${response.body}`);
  }
  const state = parseJsonObject(response.body)?.state;
  const fields = state !== null && typeof state === 'object' ? (state as Record<string, unknown>) : undefined;
  return { content: stringField(fields, 'content') ?? '', updatedAt: stringField(fields, 'updated_at') ?? '' };
}

/** Replace the slot as the agent itself. */
export async function writeOwnState(ctx: Context, handle: string, identifier: string, content: string): Promise<void> {
  const workspace = requireWorkspaceFile(ctx);
  const token = await agentTokenFor(ctx, handle);
  const response = await ctx.http({
    method: 'POST',
    url: stateUrl(ctx, handle, identifier, 'replace'),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!isSuccess(response.status)) {
    throw new CliError(`unable to write state ${identifier} of agent ${handle} (http ${response.status}): ${response.body}`);
  }
}
