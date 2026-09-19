import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { extractJwt, tokenStoreCommand } from '../src/commands/token_store.ts';
import { testContext } from './helpers.ts';

const EMAIL = 'user@example.com';
const VERIFY_BODY = '# Logged in\n\nYour auth JWT token:\n\n```\nTHE.JWT.VALUE\n```\n\nKeep it safe.\n';

test('send-email-code prints ok, or the failure code with exit 1', async () => {
  const ctx = testContext();
  assert.deepEqual(await tokenStoreCommand(ctx, ['send-email-code', EMAIL]), { stdout: 'ok\n', exitCode: 0 });
  assert.equal(ctx.requests[0]!.url, 'https://pilely.app/~/login');
  assert.deepEqual(JSON.parse(ctx.requests[0]!.body!), { email: EMAIL });

  const limited = testContext(() => ({ status: 429, body: '{"ok":false,"code":"rate_limited"}' }));
  assert.deepEqual(await tokenStoreCommand(limited, ['send-email-code', EMAIL]), { stdout: 'rate_limited\n', exitCode: 1 });
});

test('verify-email-code stores the token, writes the account file, prints only the handle', async () => {
  const ctx = testContext((request) =>
    request.url.endsWith('/verify_auth_code')
      ? { status: 200, body: VERIFY_BODY }
      : { status: 200, body: '{"ok":true,"user_handle":"alice"}' },
  );
  const result = await tokenStoreCommand(ctx, ['verify-email-code', EMAIL, '123456']);
  assert.deepEqual(result, { stdout: 'alice\n', exitCode: 0 });
  assert.equal(ctx.requests[0]!.headers!.Accept, 'text/plain');
  assert.deepEqual(JSON.parse(ctx.requests[0]!.body!), { email: EMAIL, auth_code: '123456' });
  assert.equal(ctx.secrets.get(`pile.ly/${EMAIL}`), 'THE.JWT.VALUE');
  assert.equal(readFileSync(ctx.config.accountIdFile, 'utf8').trim(), EMAIL);
  assert.ok(!result.stdout.includes('THE.JWT.VALUE'));
  assert.equal(ctx.requests[1]!.headers!.Authorization, 'Bearer THE.JWT.VALUE');
});

test('a refused code stores nothing', async () => {
  const ctx = testContext(() => ({ status: 401, body: 'nope' }));
  assert.deepEqual(await tokenStoreCommand(ctx, ['verify-email-code', EMAIL, '000000']), { stdout: 'unauthorized\n', exitCode: 1 });
  assert.equal(ctx.secrets.size, 0);
  assert.ok(!existsSync(ctx.config.accountIdFile));
});

test('status', async () => {
  const ctx = testContext();
  assert.deepEqual(await tokenStoreCommand(ctx, ['status']), { stdout: 'no account stored\n', exitCode: 1 });

  const valid = testContext((request) =>
    request.url.endsWith('/verify_auth_code') ? { status: 200, body: VERIFY_BODY } : { status: 200, body: '{"user_handle":"alice"}' },
  );
  await tokenStoreCommand(valid, ['verify-email-code', EMAIL, '123456']);
  assert.deepEqual(await tokenStoreCommand(valid, ['status']), { stdout: `${EMAIL}: valid\n`, exitCode: 0 });

  valid.http = async () => ({ status: 401, body: '' });
  assert.deepEqual(await tokenStoreCommand(valid, ['status']), { stdout: `${EMAIL}: invalid (http 401)\n`, exitCode: 1 });
});

test('bad input', async () => {
  const ctx = testContext();
  await assert.rejects(tokenStoreCommand(ctx, ['send-email-code', 'not-an-email']), /not an email/);
  await assert.rejects(tokenStoreCommand(ctx, ['send-email-code']), /usage:/);
  await assert.rejects(tokenStoreCommand(ctx, []), /usage:/);
  assert.equal(ctx.requests.length, 0);
});

test('extractJwt reads only the fenced block after the marker line', () => {
  assert.equal(extractJwt(VERIFY_BODY), 'THE.JWT.VALUE');
  assert.equal(extractJwt('```\nOTHER\n```\n'), undefined);
  assert.equal(extractJwt('Your auth JWT token\n```\n```\n'), undefined);
});
