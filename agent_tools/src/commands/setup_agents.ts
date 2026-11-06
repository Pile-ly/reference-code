// pilely workspace setup-agents — writes the files a harness reads the
// teammates' models and efforts from, straight from the table on the
// guides' `launch_teammate` page, so nobody copies an id by hand.
//
//   setup-agents claude-code <launch_teammate page url>
//   setup-agents codex <launch_teammate page url>
//
// claude-code writes `.claude/agents/<name>.md` for every row (model and
// effort from the Claude Code columns) and removes a Pilely file whose name
// is no longer in the table. codex writes the Pilely block of `AGENTS.md`
// (model and effort from the Codex columns), creating the file, appending
// the block, or replacing only the block. A file that already says the
// same is left alone. Prints one line per file: created, updated,
// unchanged or removed. A table that cannot be read writes nothing.

import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Context } from '../context.ts';
import { CliError, ok } from '../errors.ts';
import type { CommandResult } from '../errors.ts';
import { writeFileAtomically } from '../files.ts';
import { isSuccess } from '../http.ts';

const USAGE = 'usage: pilely workspace setup-agents {claude-code|codex} <launch_teammate page url>';

export interface TeammateRow {
  /** The Teammate cell, e.g. `Kevin` or `Intern, plan job`. */
  label: string;
  /** The agent's name: the Claude Code subagent_type and the `AGENTS.md` row. */
  name: string;
  claudeCode: { model: string; effort: string };
  codex: { model: string; effort: string };
}

const HEADER = [
  'Teammate',
  'Name',
  'Template',
  'Model on Claude Code',
  'Effort on Claude Code',
  'Model on Codex (ChatGpt)',
  'Effort on Codex',
];

const AGENT_BODY =
  'You are a Pilely teammate. The message that launched you is your launch prompt; it tells you who you are and what to do. Follow it.';

const BLOCK_START = '<!-- pilely teammates: start -->';
const BLOCK_END = '<!-- pilely teammates: end -->';

export async function setupAgentsCommand(ctx: Context, args: string[]): Promise<CommandResult> {
  const [harness, url, ...extra] = args;
  if (!url || extra.length !== 0 || (harness !== 'claude-code' && harness !== 'codex')) throw new CliError(USAGE);
  const response = await ctx.http({ method: 'GET', url });
  if (!isSuccess(response.status)) throw new CliError(`could not read ${url} (http ${response.status})`);
  const rows = parseTeammateTable(response.body);
  const lines = harness === 'claude-code' ? writeClaudeAgents(ctx, rows) : writeAgentsMd(ctx, rows);
  return ok(lines.map((line) => `${line}\n`).join(''));
}

/** Reads the teammate table; throws on anything that is not exactly its shape. */
export function parseTeammateTable(page: string): TeammateRow[] {
  const lines = page.split('\n');
  const start = lines.findIndex((line) => sameCells(cells(line), HEADER));
  if (start === -1) throw new CliError(`no teammate table on the page (header: | ${HEADER.join(' | ')} |)`);
  const rows: TeammateRow[] = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.trim().startsWith('|')) break;
    const row = cells(line);
    if (row.length !== HEADER.length) throw new CliError(`a teammate row has ${row.length} cells: ${line}`);
    const name = code(row[1]!, line);
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new CliError(`not an agent name: ${name}`);
    if (rows.some((r) => r.name === name)) throw new CliError(`the name ${name} is in the table twice`);
    rows.push({
      label: row[0]!,
      name,
      claudeCode: { model: code(row[3]!, line), effort: code(row[4]!, line) },
      codex: { model: code(row[5]!, line), effort: code(row[6]!, line) },
    });
  }
  if (rows.length === 0) throw new CliError('the teammate table has no rows');
  return rows;
}

function cells(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return [];
  return trimmed
    .slice(1, -1)
    .split('|')
    .map((cell) => cell.trim());
}

function sameCells(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((cell, i) => cell === b[i]);
}

/** The last `code` span in a cell: `Sonnet 5 (\`sonnet\`)` gives `sonnet`. */
function code(cell: string, line: string): string {
  const spans = [...cell.matchAll(/`([^`]+)`/g)];
  const value = spans.at(-1)?.[1];
  if (!value || !/^[A-Za-z0-9._-]+$/.test(value)) throw new CliError(`a teammate cell has no id in backticks: ${line}`);
  return value;
}

function agentFile(row: TeammateRow): string {
  return [
    '---',
    `name: ${row.name}`,
    `description: Pilely teammate: ${row.label}. Launched with a launch prompt.`,
    `model: ${row.claudeCode.model}`,
    `effort: ${row.claudeCode.effort}`,
    '---',
    '',
    AGENT_BODY,
    '',
  ].join('\n');
}

function writeClaudeAgents(ctx: Context, rows: TeammateRow[]): string[] {
  const dir = ctx.config.claudeAgentsDir;
  const lines: string[] = [];
  const names = new Set(rows.map((row) => row.name));
  if (existsSync(dir)) {
    for (const entry of readdirSync(dir).sort()) {
      if (!entry.endsWith('.md') || names.has(entry.slice(0, -3))) continue;
      const file = join(dir, entry);
      // Only files this tree wrote: their description starts with "Pilely ".
      if (/^description: Pilely /m.test(readFileSync(file, 'utf8'))) {
        rmSync(file);
        lines.push(`removed ${file}`);
      }
    }
  }
  for (const row of rows) {
    lines.push(writeIfChanged(join(dir, `${row.name}.md`), agentFile(row)));
  }
  return lines;
}

function agentsMdBlock(rows: TeammateRow[]): string {
  return [
    BLOCK_START,
    '## Pilely teammates',
    '',
    'This folder is a Pilely workspace. Pam, the assistant working in it, launches teammates as sub-agents. Whenever one is launched with `spawn_agent`, set `fork_turns` to `"none"`, set `model` to the id listed here for its name and `model_reasoning_effort` to the effort listed here:',
    '',
    '| Name | model | model_reasoning_effort |',
    '| --- | --- | --- |',
    ...rows.map((row) => `| ${row.name} | ${row.codex.model} | ${row.codex.effort} |`),
    BLOCK_END,
  ].join('\n');
}

function writeAgentsMd(ctx: Context, rows: TeammateRow[]): string[] {
  const file = ctx.config.agentsMdFile;
  const block = agentsMdBlock(rows);
  if (!existsSync(file)) return [writeIfChanged(file, `${block}\n`)];
  const current = readFileSync(file, 'utf8');
  const start = current.indexOf(BLOCK_START);
  const end = current.indexOf(BLOCK_END);
  if (start === -1 || end < start) {
    const separator = current === '' || current.endsWith('\n\n') ? '' : current.endsWith('\n') ? '\n' : '\n\n';
    return [writeIfChanged(file, `${current}${separator}${block}\n`)];
  }
  return [writeIfChanged(file, `${current.slice(0, start)}${block}${current.slice(end + BLOCK_END.length)}`)];
}

function writeIfChanged(file: string, content: string): string {
  const before = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
  if (before === content) return `unchanged ${file}`;
  writeFileAtomically(file, content);
  return `${before === undefined ? 'created' : 'updated'} ${file}`;
}
