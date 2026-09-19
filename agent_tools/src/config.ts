// Every value a tool reads from its environment, in one place. The file
// paths are relative on purpose: the tools run from the session's working
// directory, and everything they keep on disk lives under it.

export interface Config {
  apexHost: string;
  apexBaseUrl: string;
  workspaceBaseUrl: string;
  agentBaseUrl: string;
  accountIdFile: string;
  workspaceFile: string;
  guideVersionFile: string;
  chatroomsDir: string;
  requestTimeoutMs: number;
  /** A chatroom listener exits this long after the last message it received. */
  listenerExpiryMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const apexHost = env.PILELY_APEX_HOST || 'pilely.app';
  return {
    apexHost,
    apexBaseUrl: `https://${apexHost}`,
    workspaceBaseUrl: env.PILELY_WORKSPACE_BASE_URL || 'https://simple-workspace.pilely.app',
    agentBaseUrl: env.PILELY_AGENT_BASE_URL || 'https://simple-agent.pilely.app',
    accountIdFile: env.PILELY_ACCOUNT_KEYCHAIN_ID_FILE || './.pilely_account_keychain_id',
    workspaceFile: env.PILELY_WORKSPACE_FILE || './.pilely/workspace.json',
    guideVersionFile: env.PILELY_PAM_VERSION_FILE || './.pilely/pam_version.md',
    chatroomsDir: env.PILELY_CHATROOMS_DIR || './.pilely/chatrooms',
    requestTimeoutMs: 15_000,
    listenerExpiryMs: (Number(env.PILELY_LISTENER_EXPIRY_SECS) || 60 * 60) * 1000,
  };
}
