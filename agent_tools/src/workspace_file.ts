// ./.pilely/workspace.json — the local record of this folder's workspace,
// the agents created here and the default chatroom. The platform is the
// authority on what exists; this file is what lets the tools answer
// "was that already done?" without a network call.

import { existsSync, readFileSync } from 'node:fs';
import type { Context } from './context.ts';
import { CliError } from './errors.ts';
import { withFileLock, writeJsonAtomically } from './files.ts';
import { parseJsonObject, stringField } from './http.ts';

export interface AgentRecord {
  /** A label only ("pam", "oscar"). Several agents may share a type; the handle is the identity. */
  type: string;
  /** One line on what this agent is for, so others can tell agents of one type apart. */
  purpose: string;
  agent_id: string;
  in_workspace: boolean;
  chatrooms: string[];
  created_time_stamp: string;
}

export interface WorkspaceFile {
  workspace_nanoid: string;
  owner_email: string;
  created_time_stamp: unknown;
  /** The registered app new agents are bound to. */
  app_id?: string;
  default_chatroom?: string;
  agents?: Record<string, AgentRecord>;
}

/**
 * The workspace file, or undefined when the file is absent. A file that
 * exists but names no workspace is an error, never a reason to register
 * again over it.
 */
export function readWorkspaceFile(ctx: Context): WorkspaceFile | undefined {
  const file = ctx.config.workspaceFile;
  if (!existsSync(file)) return undefined;
  const json = parseJsonObject(readFileSync(file, 'utf8'));
  if (!stringField(json, 'workspace_nanoid')) {
    throw new CliError(`${file} exists but names no workspace; inspect it before registering again`);
  }
  return json as unknown as WorkspaceFile;
}

export function requireWorkspaceFile(ctx: Context): WorkspaceFile {
  const workspace = readWorkspaceFile(ctx);
  if (!workspace) {
    throw new CliError(`no workspace registered: ${ctx.config.workspaceFile} (run pilely workspace register)`);
  }
  return workspace;
}

export function writeWorkspaceFile(ctx: Context, workspace: WorkspaceFile): void {
  writeJsonAtomically(ctx.config.workspaceFile, workspace);
}

/** Re-reads the file, applies one change, writes it back — under a lock, so concurrent tools never lose a change. */
export function updateWorkspaceFile(ctx: Context, change: (workspace: WorkspaceFile) => void): WorkspaceFile {
  return withFileLock(ctx.config.workspaceFile, () => {
    const workspace = requireWorkspaceFile(ctx);
    change(workspace);
    writeWorkspaceFile(ctx, workspace);
    return workspace;
  });
}

export function requireAgent(workspace: WorkspaceFile, handle: string): AgentRecord {
  const agent = workspace.agents?.[handle];
  if (!agent) throw new CliError(`no agent ${handle} on file (run pilely workspace list-agents)`);
  return agent;
}
