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
  /** Every invocation appends one JSON line here. */
  toolLogFile: string;
  /** Where Claude Code reads subagent files; `setup-agents claude-code` writes them. */
  claudeAgentsDir: string;
  /** The folder's instructions for Codex; `setup-agents codex` writes its Pilely block. */
  agentsMdFile: string;
  requestTimeoutMs: number;
  /** A chatroom listener exits this long after the last message it received. */
  listenerExpiryMs: number;
  /** The machine's language as a BCP 47 tag (`ja-JP`), or undefined when none is readable. */
  systemLanguage: string | undefined;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  runtimeLocale: string | undefined = Intl.DateTimeFormat().resolvedOptions().locale,
): Config {
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
    toolLogFile: env.PILELY_TOOL_LOG_FILE || './.pilely/tool.log',
    claudeAgentsDir: './.claude/agents',
    agentsMdFile: './AGENTS.md',
    requestTimeoutMs: 15_000,
    listenerExpiryMs: (Number(env.PILELY_LISTENER_EXPIRY_SECS) || 60 * 60) * 1000,
    systemLanguage: systemLanguage(env, runtimeLocale),
  };
}

/**
 * The machine's language: the first set POSIX locale variable (LC_ALL, then
 * LC_MESSAGES, then LANG), else the runtime's default locale. A POSIX value
 * like `ja_JP.UTF-8` becomes `ja-JP`. `C`, `POSIX`, an empty value or
 * anything that is not a language tag reads as undefined, so the caller
 * sends no language at all.
 */
export function systemLanguage(env: NodeJS.ProcessEnv, runtimeLocale: string | undefined): string | undefined {
  const posix = env.LC_ALL || env.LC_MESSAGES || env.LANG;
  if (posix) return languageTag(posix.split(/[.@]/)[0]!.replace(/_/g, '-'));
  // Unicode (`-u-`) and private-use (`-x-`) extensions are not language.
  return runtimeLocale ? languageTag(runtimeLocale.split(/-[ux]-/)[0]!) : undefined;
}

function languageTag(value: string): string | undefined {
  if (value === 'C' || value === 'POSIX' || value === 'und') return undefined;
  return /^[A-Za-z]{2,8}(-[A-Za-z0-9]{1,8})*$/.test(value) ? value : undefined;
}
