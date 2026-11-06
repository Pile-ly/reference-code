import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeAccountEmail } from '../src/account.ts';
import { fetchCommand } from '../src/commands/fetch.ts';
import { secretStoreCommand } from '../src/commands/secret_store.ts';
import { redactSecrets } from '../src/secrets.ts';
import { MINT_OK, testContext } from './helpers.ts';

const EMAIL = 'user@example.com';
const API = 'shop-api.pilely.app';
// Built at run time: the public mirror's guard refuses a key-shaped literal.
const LIVE_KEY = ['sk', 'live', '51AbCdEfGhIjKlMnOp'].join('_');

function loggedIn(respond?: Parameters<typeof testContext>[0]) {
  const ctx = testContext(respond);
  writeAccountEmail(ctx, EMAIL);
  ctx.secrets.set(`pile.ly/${EMAIL}`, 'LOGIN.JWT');
  return ctx;
}

test('ask saves what the person pasted, prints only the name, and lists it', () => {
  const ctx = loggedIn();
  ctx.pasted.value = `  ${LIVE_KEY}  `;
  const result = secretStoreCommand(ctx, ['ask', API, 'STRIPE_SECRET_KEY_LIVE', 'Paste your live secret key']);
  assert.deepEqual(result, { stdout: 'saved STRIPE_SECRET_KEY_LIVE\n', exitCode: 0 });
  assert.deepEqual(ctx.pasted.asked, [{ title: `Pilely — ${API}`, prompt: 'Paste your live secret key' }]);
  assert.equal(ctx.secrets.get(`pile.ly.secret/${EMAIL}:${API}:STRIPE_SECRET_KEY_LIVE`), LIVE_KEY);
  assert.equal(secretStoreCommand(ctx, ['list', API]).stdout, 'STRIPE_SECRET_KEY_LIVE\n');
});

test('ask: cancel saves nothing; --expect refuses the wrong kind of key without echoing it', () => {
  const ctx = loggedIn();
  ctx.pasted.value = undefined;
  assert.deepEqual(secretStoreCommand(ctx, ['ask', API, 'K', 'p']), { stdout: 'cancelled\n', exitCode: 3 });

  ctx.pasted.value = 'sk_test_not_the_live_one';
  const result = secretStoreCommand(ctx, ['ask', API, 'K', 'p', '--expect', 'sk_live_']);
  assert.deepEqual(result, { stdout: 'not_saved: it does not start with sk_live_\n', exitCode: 1 });
  assert.equal(secretStoreCommand(ctx, ['list', API]).stdout, 'none\n');
});

test('delete removes the value and the name; a second delete is fine', () => {
  const ctx = loggedIn();
  ctx.pasted.value = LIVE_KEY;
  secretStoreCommand(ctx, ['ask', API, 'A', 'p']);
  secretStoreCommand(ctx, ['ask', API, 'B', 'p']);
  assert.equal(secretStoreCommand(ctx, ['list', API]).stdout, 'A\nB\n');
  assert.equal(secretStoreCommand(ctx, ['delete', API, 'A']).stdout, 'deleted A\n');
  assert.equal(secretStoreCommand(ctx, ['delete', API, 'A']).stdout, 'deleted A\n');
  assert.equal(secretStoreCommand(ctx, ['list', API]).stdout, 'B\n');
  assert.equal(ctx.secrets.get(`pile.ly.secret/${EMAIL}:${API}:A`), undefined);
});

test('names and hosts are checked; usage errors', () => {
  const ctx = loggedIn();
  assert.throws(() => secretStoreCommand(ctx, ['ask', API, 'lower', 'p']), /not a secret name/);
  assert.throws(() => secretStoreCommand(ctx, ['ask', 'not a host', 'K', 'p']), /not an app host/);
  assert.throws(() => secretStoreCommand(ctx, ['ask', API, 'K']), /usage:/);
  assert.throws(() => secretStoreCommand(ctx, ['nope']), /usage:/);
  assert.throws(() => secretStoreCommand(testContext(), ['list', API]), /no account on file/);
});

test('fetch fills [[secret:...]] into a simple-env body, JSON-escaped, and never prints it', async () => {
  const ctx = loggedIn((request) =>
    request.url.endsWith('/~/mint/app_id_token') ? MINT_OK : { status: 200, body: `{"ok":true,"echo":"${LIVE_KEY}"}` },
  );
  ctx.secrets.set(`pile.ly.secret/${EMAIL}:${API}:STRIPE_SECRET_KEY_LIVE`, 'sk_live_"quoted"\\x');
  ctx.secrets.set(`pile.ly.secret/${EMAIL}:${API}:PLAIN`, LIVE_KEY);
  const body = `{"set":{"STRIPE_SECRET_KEY":"[[secret:${API}/STRIPE_SECRET_KEY_LIVE]]","B":"[[secret:${API}/PLAIN]]"}}`;
  const result = await fetchCommand(ctx, ['POST', 'https://simple-env.pilely.app/env_1/patch', body, '--as', API]);
  const sent = JSON.parse(ctx.requests[1]!.body!);
  assert.equal(sent.set.STRIPE_SECRET_KEY, 'sk_live_"quoted"\\x');
  assert.equal(sent.set.B, LIVE_KEY);
  assert.equal(result.stdout, '{"ok":true,"echo":"<redacted>"}');
});

test('fetch refuses a placeholder for any other host, before sending anything', async () => {
  const ctx = loggedIn();
  ctx.secrets.set(`pile.ly.secret/${EMAIL}:${API}:K`, LIVE_KEY);
  for (const url of ['https://simple-db.pilely.app/x', 'https://evil.example.com/x', 'https://pilely.app/~/me']) {
    await assert.rejects(fetchCommand(ctx, ['POST', url, `{"k":"[[secret:${API}/K]]"}`]), /is filled in only for/);
  }
  assert.equal(ctx.requests.length, 0);
});

test('a missing secret names the ref and sends nothing', async () => {
  const ctx = loggedIn();
  await assert.rejects(
    fetchCommand(ctx, ['POST', 'https://simple-env.pilely.app/e/patch', `{"k":"[[secret:${API}/GONE]]"}`]),
    /no secret saved as shop-api.pilely.app\/GONE/,
  );
  assert.equal(ctx.requests.length, 0);
});

test('Stripe: the saved key is the bearer, the body is a form, no Pilely token is ever sent', async () => {
  const ctx = loggedIn(() => ({ status: 200, body: '{"id":"we_1","secret":"whsec_abcdefghijkl"}' }));
  ctx.pasted.value = 'sk_test_51ZzZzZzZzZz';
  secretStoreCommand(ctx, ['ask', API, 'STRIPE_SECRET_KEY', 'p']);
  const result = await fetchCommand(ctx, [
    'POST',
    'https://api.stripe.com/v1/webhook_endpoints',
    'url=https%3A%2F%2Fshop-api.pilely.app%2Fwebhooks%2Fstripe&enabled_events[]=invoice.paid',
    '--bearer-secret',
    `${API}/STRIPE_SECRET_KEY`,
    '--save-secret',
    `secret=${API}/STRIPE_WEBHOOK_SECRET`,
  ]);
  assert.equal(ctx.requests.length, 1);
  const request = ctx.requests[0]!;
  assert.equal(request.headers!.Authorization, 'Bearer sk_test_51ZzZzZzZzZz');
  assert.equal(request.headers!['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(
    result.stdout,
    `{"id":"we_1","secret":"<saved to keychain: ${API}/STRIPE_WEBHOOK_SECRET>"}`,
  );
  assert.equal(result.exitCode, 0);
  assert.equal(ctx.secrets.get(`pile.ly.secret/${EMAIL}:${API}:STRIPE_WEBHOOK_SECRET`), 'whsec_abcdefghijkl');
  assert.equal(secretStoreCommand(ctx, ['list', API]).stdout, 'STRIPE_SECRET_KEY\nSTRIPE_WEBHOOK_SECRET\n');
});

test('Stripe: a form placeholder is URL-encoded; a GET works; no key means no call', async () => {
  const ctx = loggedIn(() => ({ status: 200, body: '{"data":[]}' }));
  ctx.secrets.set(`pile.ly.secret/${EMAIL}:${API}:K`, 'sk_test_aaaaaaaaaaaa');
  ctx.secrets.set(`pile.ly.secret/${EMAIL}:${API}:V`, 'a b&c');
  await fetchCommand(ctx, ['POST', 'https://api.stripe.com/v1/x', `v=[[secret:${API}/V]]`, '--bearer-secret', `${API}/K`]);
  assert.equal(ctx.requests[0]!.body, 'v=a%20b%26c');
  await fetchCommand(ctx, ['GET', 'https://api.stripe.com/v1/prices', '--bearer-secret', `${API}/K`]);
  assert.equal(ctx.requests[1]!.method, 'GET');
  await assert.rejects(fetchCommand(ctx, ['GET', 'https://api.stripe.com/v1/prices']), /needs --bearer-secret/);
  await assert.rejects(
    fetchCommand(ctx, ['GET', 'https://simple-db.pilely.app/x', '--bearer-secret', `${API}/K`]),
    /only applies to api.stripe.com/,
  );
  assert.equal(ctx.requests.length, 2);
});

test('--save-secret on the sandbox create answer keeps the keys out of the output', async () => {
  const answer = {
    ok: true,
    sandbox: { sandbox_uuid: 'sb_1' },
    keys: { publishable_key: 'pk_test_123456789', secret_key: 'sk_test_51SeCrEtVaLuE', mcp_key: 'ek_test_MCPvalue1' },
  };
  const ctx = loggedIn((request) =>
    request.url.includes('/~/mint/') ? MINT_OK : { status: 200, body: JSON.stringify(answer) },
  );
  const result = await fetchCommand(ctx, [
    'POST',
    'https://simple-payment.pilely.app/stripe/sandbox_management/create',
    '{"pile_id":"p","country":"US"}',
    '--json',
    '--save-secret',
    `keys.secret_key=${API}/STRIPE_SECRET_KEY`,
    '--save-secret',
    `keys.mcp_key=${API}/STRIPE_MCP_KEY`,
  ]);
  const printed = JSON.parse(result.stdout);
  assert.equal(printed.keys.publishable_key, 'pk_test_123456789');
  assert.equal(printed.keys.secret_key, `<saved to keychain: ${API}/STRIPE_SECRET_KEY>`);
  assert.equal(printed.keys.mcp_key, `<saved to keychain: ${API}/STRIPE_MCP_KEY>`);
  assert.equal(ctx.secrets.get(`pile.ly.secret/${EMAIL}:${API}:STRIPE_SECRET_KEY`), 'sk_test_51SeCrEtVaLuE');
});

test('--save-secret: a missing field or a non-JSON answer fails the call; an error answer saves nothing', async () => {
  const ctx = loggedIn((request) =>
    request.url.includes('/~/mint/') ? MINT_OK : { status: 200, body: '{"ok":true}' },
  );
  const missing = await fetchCommand(ctx, ['POST', 'https://a.pilely.app/x', '--save-secret', `keys.secret_key=${API}/K`]);
  assert.equal(missing.exitCode, 1);
  assert.match(ctx.notes.join('\n'), /was not saved/);

  const markdown = loggedIn((request) => (request.url.includes('/~/mint/') ? MINT_OK : { status: 200, body: '# Card' }));
  assert.equal((await fetchCommand(markdown, ['POST', 'https://a.pilely.app/x', '--save-secret', `k=${API}/K`])).exitCode, 1);

  const refused = loggedIn((request) =>
    request.url.includes('/~/mint/') ? MINT_OK : { status: 409, body: '{"ok":false,"k":"sk_test_leakleakleak"}' },
  );
  const result = await fetchCommand(refused, ['POST', 'https://a.pilely.app/x', '--save-secret', `k=${API}/K`]);
  assert.equal(result.exitCode, 4);
  assert.equal(result.stdout, '{"ok":false,"k":"<redacted>"}');
  assert.equal(refused.secrets.get(`pile.ly.secret/${EMAIL}:${API}:K`), undefined);
});

test('every fetch output is scrubbed of Stripe secrets, and publishable keys stay', async () => {
  const ctx = loggedIn(() => ({
    status: 200,
    body: 'sk_live_abc123 rk_live_abc123 whsec_abc123 ek_test_abc pk_live_keepme',
  }));
  const result = await fetchCommand(ctx, ['GET', 'https://pilely.app/x']);
  assert.equal(result.stdout, '<redacted> <redacted> <redacted> <redacted> pk_live_keepme');
  assert.equal(redactSecrets('the week_1 check_ek_x'), 'the week_1 check_ek_x');
});
