import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeAccountEmail } from '../src/account.ts';
import { fetchCommand, parseArgs } from '../src/commands/fetch.ts';
import { withMarkdownSuffix } from '../src/pilely_request.ts';
import { MINT_OK, testContext } from './helpers.ts';

const EMAIL = 'user@example.com';

function loggedIn(respond?: Parameters<typeof testContext>[0]) {
  const ctx = testContext(respond);
  writeAccountEmail(ctx, EMAIL);
  ctx.secrets.set(`pile.ly/${EMAIL}`, 'LOGIN.JWT');
  return ctx;
}

test('apex GET sends the login token and appends .md', async () => {
  const ctx = loggedIn(() => ({ status: 200, body: '# manual' }));
  const result = await fetchCommand(ctx, ['GET', 'https://pilely.app/skill/x?a=1']);
  assert.deepEqual(result, { stdout: '# manual', exitCode: 0 });
  assert.equal(ctx.requests[0]!.url, 'https://pilely.app/skill/x.md?a=1');
  assert.equal(ctx.requests[0]!.headers!.Authorization, 'Bearer LOGIN.JWT');
});

test('apex POST asks for JSON and defaults the body to {}', async () => {
  const ctx = loggedIn();
  await fetchCommand(ctx, ['POST', 'https://pilely.app/~/me']);
  const request = ctx.requests[0]!;
  assert.equal(request.headers!.Accept, 'application/json');
  assert.equal(request.body, '{}');
});

test('a non-apex host gets a minted app token and never the login token', async () => {
  const ctx = loggedIn((request) => (request.url.endsWith('/~/mint/app_id_token') ? MINT_OK : { status: 200, body: 'ok' }));
  await fetchCommand(ctx, ['POST', 'https://simple-db.pilely.app/x', '{"a":1}']);
  const [mint, target] = ctx.requests;
  assert.equal(JSON.parse(mint!.body!).target, 'simple-db.pilely.app');
  assert.equal(target!.headers!.Authorization, 'Bearer MINTED.TOKEN');
  assert.equal(target!.headers!.Accept, undefined);
  assert.equal(target!.body, '{"a":1}');
  assert.equal(ctx.secrets.get(`pile.ly.app_token/${EMAIL}:simple-db.pilely.app`), '9999999999999:MINTED.TOKEN');
});

test('a cached app token is reused; an expiring one is re-minted', async () => {
  const ctx = loggedIn((request) => (request.url.includes('/~/mint/') ? MINT_OK : { status: 200, body: 'ok' }));
  ctx.secrets.set(`pile.ly.app_token/${EMAIL}:a.pilely.app`, '9999999999999:CACHED');
  await fetchCommand(ctx, ['GET', 'https://a.pilely.app/x']);
  assert.equal(ctx.requests.length, 1);
  assert.equal(ctx.requests[0]!.headers!.Authorization, 'Bearer CACHED');

  const soon = ctx.now().getTime() + 10_000;
  ctx.secrets.set(`pile.ly.app_token/${EMAIL}:a.pilely.app`, `${soon}:DYING`);
  await fetchCommand(ctx, ['GET', 'https://a.pilely.app/x']);
  assert.equal(ctx.requests.at(-1)!.headers!.Authorization, 'Bearer MINTED.TOKEN');
});

test('--as mints for the named app, --json asks for JSON', async () => {
  const ctx = loggedIn((request) => (request.url.includes('/~/mint/') ? MINT_OK : { status: 200, body: 'ok' }));
  await fetchCommand(ctx, ['POST', 'https://simple-db.pilely.app/x', '--as', 'myapp.pilely.app', '--json']);
  assert.equal(JSON.parse(ctx.requests[0]!.body!).target, 'myapp.pilely.app');
  assert.equal(ctx.requests[1]!.headers!.Accept, 'application/json');
});

test('--as is refused on the apex', async () => {
  const ctx = loggedIn();
  await assert.rejects(fetchCommand(ctx, ['POST', 'https://pilely.app/x', '--as', 'a.pilely.app']), /only applies off the apex/);
});

test('exit code follows the response class', async () => {
  for (const [status, exitCode] of [[204, 0], [404, 4], [503, 5], [302, 1]] as const) {
    const ctx = loggedIn(() => ({ status, body: 'b' }));
    assert.equal((await fetchCommand(ctx, ['GET', 'https://pilely.app/x'])).exitCode, exitCode);
  }
});

test('a failed mint names the reason and sends nothing to the target', async () => {
  const ctx = loggedIn(() => ({ status: 403, body: '{"ok":false,"code":"forbidden"}' }));
  await assert.rejects(fetchCommand(ctx, ['GET', 'https://a.pilely.app/x']), /forbidden \(http 403\)/);
  assert.equal(ctx.requests.length, 1);
});

test('no account on file, no login token, bad usage', async () => {
  await assert.rejects(fetchCommand(testContext(), ['GET', 'https://pilely.app/x']), /no account on file/);
  const ctx = testContext();
  writeAccountEmail(ctx, EMAIL);
  await assert.rejects(fetchCommand(ctx, ['GET', 'https://pilely.app/x']), /no login token stored/);
  assert.throws(() => parseArgs([]), /usage:/);
  assert.throws(() => parseArgs(['GET', 'https://pilely.app/x', 'extra']), /usage:/);
  assert.throws(() => parseArgs(['PUT', 'https://pilely.app/x']), /usage:/);
  assert.throws(() => parseArgs(['POST', 'https://pilely.app/x', '{}', '{}']), /usage:/);
});

test('a non-https URL is refused before any token is read', async () => {
  const ctx = loggedIn();
  await assert.rejects(fetchCommand(ctx, ['GET', 'http://pilely.app/x']), /non-https/);
  assert.equal(ctx.requests.length, 0);
});

test('withMarkdownSuffix', () => {
  assert.equal(withMarkdownSuffix('https://pilely.app/a.md'), 'https://pilely.app/a.md');
  assert.equal(withMarkdownSuffix('https://pilely.app/'), 'https://pilely.app/index.md');
});
