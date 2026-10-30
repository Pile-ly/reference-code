import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseTeammateTable } from '../src/commands/setup_agents.ts';
import { workspaceCommand } from '../src/commands/workspace.ts';
import { testContext } from './helpers.ts';

const URL = 'https://pam.pilely.app/launch_teammate.md';

const PAGE = `# Launch teammate

Some words.

| Teammate | Name | Template | Model on Claude Code | Effort on Claude Code | Model on Codex (ChatGpt) | Effort on Codex |
| --- | --- | --- | --- | --- | --- | --- |
| Kevin | \`kevin\` | \`https://pam.pilely.app/launch_teammate/kevin\` | Sonnet 5.5 (\`sonnet\`) | \`medium\` | GPT-6 Luna (\`gpt-6-luna\`) | \`high\` |
| Intern, plan job | \`intern-plan\` | \`https://pam.pilely.app/launch_teammate/intern\` | Opus 5.5 (\`opus\`) | \`high\` | GPT-6 Luna (\`gpt-6-luna\`) | \`high\` |

After the table.
`;

function pageContext(page = PAGE, status = 200) {
  return testContext(() => ({ status, body: page }));
}

test('the table is read row by row, ids from the last backticks of each cell', () => {
  assert.deepEqual(parseTeammateTable(PAGE), [
    {
      label: 'Kevin',
      name: 'kevin',
      claudeCode: { model: 'sonnet', effort: 'medium' },
      codex: { model: 'gpt-6-luna', effort: 'high' },
    },
    {
      label: 'Intern, plan job',
      name: 'intern-plan',
      claudeCode: { model: 'opus', effort: 'high' },
      codex: { model: 'gpt-6-luna', effort: 'high' },
    },
  ]);
});

test('a page without the table, or with a broken row, is refused', () => {
  assert.throws(() => parseTeammateTable('# nothing here\n'), /no teammate table/);
  assert.throws(() => parseTeammateTable(PAGE.replace('Opus 5.5 (`opus`)', 'Opus 5.5')), /no id in backticks/);
  assert.throws(() => parseTeammateTable(PAGE.replace('`intern-plan`', '`kevin`')), /twice/);
  assert.throws(() => parseTeammateTable(PAGE.replace('`intern-plan`', '`Intern Plan`')), /no id in backticks|not an agent name/);
  assert.throws(() => parseTeammateTable(PAGE.replace('| `high` |\n\nAfter', '|\n\nAfter')), /cells/);
});

test('claude-code writes one agent file per row, then leaves them alone', async () => {
  const ctx = pageContext();
  const first = await workspaceCommand(ctx, ['setup-agents', 'claude-code', URL]);
  const kevin = join(ctx.config.claudeAgentsDir, 'kevin.md');
  const plan = join(ctx.config.claudeAgentsDir, 'intern-plan.md');
  assert.equal(first.stdout, `created ${kevin}\ncreated ${plan}\n`);
  assert.equal(ctx.requests[0]!.url, URL);
  assert.equal(ctx.requests[0]!.headers, undefined);
  assert.equal(
    readFileSync(plan, 'utf8'),
    [
      '---',
      'name: intern-plan',
      'description: Pilely teammate: Intern, plan job. Launched with a launch prompt.',
      'model: opus',
      'effort: high',
      '---',
      '',
      'You are a Pilely teammate. The message that launched you is your launch prompt; it tells you who you are and what to do. Follow it.',
      '',
    ].join('\n'),
  );

  const second = await workspaceCommand(ctx, ['setup-agents', 'claude-code', URL]);
  assert.equal(second.stdout, `unchanged ${kevin}\nunchanged ${plan}\n`);
});

test('claude-code rewrites a changed row and removes only Pilely files that left the table', async () => {
  const ctx = pageContext();
  const dir = ctx.config.claudeAgentsDir;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'kevin.md'), '---\nname: kevin\nmodel: haiku\n---\n');
  writeFileSync(join(dir, 'intern.md'), '---\nname: intern\ndescription: Pilely intern, launched for one job\n---\n');
  writeFileSync(join(dir, 'mine.md'), '---\nname: mine\ndescription: the user own agent\n---\n');

  const result = await workspaceCommand(ctx, ['setup-agents', 'claude-code', URL]);
  assert.equal(
    result.stdout,
    `removed ${join(dir, 'intern.md')}\nupdated ${join(dir, 'kevin.md')}\ncreated ${join(dir, 'intern-plan.md')}\n`,
  );
  assert.match(readFileSync(join(dir, 'kevin.md'), 'utf8'), /^model: sonnet$/m);
  assert.ok(existsSync(join(dir, 'mine.md')));
});

test('codex creates AGENTS.md with the block, then leaves it alone', async () => {
  const ctx = pageContext();
  const file = ctx.config.agentsMdFile;
  assert.equal((await workspaceCommand(ctx, ['setup-agents', 'codex', URL])).stdout, `created ${file}\n`);
  const text = readFileSync(file, 'utf8');
  assert.ok(text.startsWith('<!-- pilely teammates: start -->\n## Pilely teammates\n'));
  assert.ok(text.endsWith('| kevin | gpt-6-luna | high |\n| intern-plan | gpt-6-luna | high |\n<!-- pilely teammates: end -->\n'));
  assert.equal((await workspaceCommand(ctx, ['setup-agents', 'codex', URL])).stdout, `unchanged ${file}\n`);
  assert.ok(!existsSync(ctx.config.claudeAgentsDir));
});

test('codex appends the block to an AGENTS.md without one, and replaces only the block', async () => {
  const ctx = pageContext();
  const file = ctx.config.agentsMdFile;
  writeFileSync(file, '# My rules\n\nBe kind.\n');
  assert.equal((await workspaceCommand(ctx, ['setup-agents', 'codex', URL])).stdout, `updated ${file}\n`);
  assert.ok(readFileSync(file, 'utf8').startsWith('# My rules\n\nBe kind.\n\n<!-- pilely teammates: start -->'));

  writeFileSync(file, '# My rules\n\n<!-- pilely teammates: start -->\nold\n<!-- pilely teammates: end -->\n\nMore of mine.\n');
  await workspaceCommand(ctx, ['setup-agents', 'codex', URL]);
  const text = readFileSync(file, 'utf8');
  assert.ok(text.startsWith('# My rules\n\n<!-- pilely teammates: start -->\n## Pilely teammates'));
  assert.ok(text.endsWith('<!-- pilely teammates: end -->\n\nMore of mine.\n'));
  assert.ok(!text.includes('\nold\n'));
});

test('a page that cannot be read, or a bad call, writes nothing', async () => {
  const missing = pageContext('not found', 404);
  await assert.rejects(workspaceCommand(missing, ['setup-agents', 'claude-code', URL]), /http 404/);
  const broken = pageContext('# no table');
  await assert.rejects(workspaceCommand(broken, ['setup-agents', 'codex', URL]), /no teammate table/);
  assert.ok(!existsSync(broken.config.agentsMdFile));
  await assert.rejects(workspaceCommand(pageContext(), ['setup-agents', 'cursor', URL]), /usage/);
  await assert.rejects(workspaceCommand(pageContext(), ['setup-agents', 'codex']), /usage/);
});
