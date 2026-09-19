// initialize-pam — everything Pam needs before she can talk in this
// workspace, in one command that is safe to run in every session. It only
// calls the single-step commands, and skips every step the local files
// show is already done:
//
//   1. a "pam" agent exists            (init-agent pam)
//   2. it is in the workspace          (add-agent-to-workspace)
//   3. the default chatroom exists     (create-chatroom main --default)
//   4. the pam agent is in it          (add-agent-to-chatroom)
//   5. the chatroom's listener runs    (listen-chatroom)
//   6. a "dwight" agent exists, is in the workspace and in the chatroom
//
// Prints nothing. What it set up is state on disk, and state is read when
// it is needed — `list-agents --type pam`, `list-chatrooms`,
// `listen-status` — never carried around in an agent's memory.

import type { Context } from '../context.ts';
import { ok } from '../errors.ts';
import type { CommandResult } from '../errors.ts';
import { requireWorkspaceFile } from '../workspace_file.ts';
import { addAgentToWorkspace, initAgent } from './agents.ts';
import { addAgentToChatroom, createChatroom } from './chatrooms.ts';
import { startListener } from './listener.ts';

export const PAM_TYPE = 'pam';
export const DWIGHT_TYPE = 'dwight';
export const MAIN_CHATROOM_TITLE = 'main';

/** The one agent of this type on file, created if there is none, and in the workspace. */
const PURPOSES: Record<string, string> = {
  [PAM_TYPE]: 'speaks for the user; hands work to the teammates and relays their answers',
  [DWIGHT_TYPE]: 'watches which agents are still running',
};

async function ensureAgent(ctx: Context, type: string): Promise<string> {
  const agents = Object.entries(requireWorkspaceFile(ctx).agents ?? {});
  const handle = agents.find(([, agent]) => agent.type === type)?.[0] ?? (await initAgent(ctx, type, PURPOSES[type]!));
  await addAgentToWorkspace(ctx, handle);
  return handle;
}

export async function initializePam(ctx: Context, entryPoint: string): Promise<CommandResult> {
  const pam = await ensureAgent(ctx, PAM_TYPE);
  const room =
    requireWorkspaceFile(ctx).default_chatroom ?? (await createChatroom(ctx, MAIN_CHATROOM_TITLE, pam, true));
  await addAgentToChatroom(ctx, room, pam);
  startListener(ctx, room, pam, entryPoint);

  const dwight = await ensureAgent(ctx, DWIGHT_TYPE);
  await addAgentToChatroom(ctx, room, dwight);
  return ok();
}
