import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { extractJwt, tokenStoreCommand } from '../src/commands/token_store.ts';
import { CliError } from '../src/errors.ts';
import { loadConfig, systemLanguage } from '../src/config.ts';
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

test('send-email-code sends --lang as Accept-Language, in either position', async () => {
  const ctx = testContext();
  ctx.config.systemLanguage = 'de-DE';
  assert.deepEqual(await tokenStoreCommand(ctx, ['send-email-code', EMAIL, '--lang', 'ja']), { stdout: 'ok\n', exitCode: 0 });
  assert.deepEqual(await tokenStoreCommand(ctx, ['send-email-code', '--lang', 'pt-BR', EMAIL]), { stdout: 'ok\n', exitCode: 0 });
  assert.equal(ctx.requests[0]!.headers!['Accept-Language'], 'ja');
  assert.equal(ctx.requests[1]!.headers!['Accept-Language'], 'pt-BR');
  assert.deepEqual(JSON.parse(ctx.requests[0]!.body!), { email: EMAIL });
  assert.equal(ctx.requests[0]!.headers!.Accept, 'application/json');
});

test('send-email-code without --lang sends the system language, or no header when none is readable', async () => {
  const ctx = testContext();
  ctx.config.systemLanguage = loadConfig({ LANG: 'ja_JP.UTF-8' }, undefined).systemLanguage;
  await tokenStoreCommand(ctx, ['send-email-code', EMAIL]);
  assert.equal(ctx.requests[0]!.headers!['Accept-Language'], 'ja-JP');

  const unreadable = testContext();
  unreadable.config.systemLanguage = loadConfig({ LANG: 'C' }, 'en-US').systemLanguage;
  assert.deepEqual(await tokenStoreCommand(unreadable, ['send-email-code', EMAIL]), { stdout: 'ok\n', exitCode: 0 });
  assert.ok(!('Accept-Language' in unreadable.requests[0]!.headers!));
});

test('systemLanguage reads LC_ALL, LC_MESSAGES, LANG, then the runtime locale', () => {
  assert.equal(systemLanguage({ LC_ALL: 'fr_FR.UTF-8', LC_MESSAGES: 'de_DE', LANG: 'es_ES' }, 'en-US'), 'fr-FR');
  assert.equal(systemLanguage({ LC_MESSAGES: 'de_DE@euro', LANG: 'es_ES' }, 'en-US'), 'de-DE');
  assert.equal(systemLanguage({ LANG: 'ja_JP.UTF-8' }, 'en-US'), 'ja-JP');
  assert.equal(systemLanguage({ LANG: 'zh_CN' }, undefined), 'zh-CN');
  assert.equal(systemLanguage({}, 'ja-JP'), 'ja-JP');
  assert.equal(systemLanguage({ LANG: '' }, 'ko-KR'), 'ko-KR');
  assert.equal(systemLanguage({}, 'en-US-u-va-posix'), 'en-US');
  for (const unreadable of ['C', 'POSIX', 'C.UTF-8']) assert.equal(systemLanguage({ LANG: unreadable }, 'en-US'), undefined);
  assert.equal(systemLanguage({}, undefined), undefined);
  assert.equal(systemLanguage({}, 'und'), undefined);
  assert.equal(systemLanguage({}, ''), undefined);
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
  for (const args of [
    ['send-email-code', EMAIL, '--lang'],
    ['send-email-code', '--lang', 'ja'],
    ['send-email-code', EMAIL, 'extra', '--lang', 'ja'],
    ['send-email-code', EMAIL, '--lang', 'ja', '--lang', 'fr'],
  ]) {
    await assert.rejects(tokenStoreCommand(ctx, args), (error: unknown) => {
      assert.ok(error instanceof CliError && /usage: pilely token_store send-email-code <email> \[--lang <code>\]/.test(error.message));
      assert.equal(error.exitCode, 1);
      return true;
    });
  }
  await assert.rejects(tokenStoreCommand(ctx, ['send-email-code', EMAIL, '--lang', 'ja\r\nX: y']), /not a language code/);
  await assert.rejects(tokenStoreCommand(ctx, []), /usage:/);
  assert.equal(ctx.requests.length, 0);
});

test('extractJwt reads only the fenced block after the marker line', () => {
  assert.equal(extractJwt(VERIFY_BODY), 'THE.JWT.VALUE');
  assert.equal(extractJwt('```\nOTHER\n```\n'), undefined);
  assert.equal(extractJwt('Your auth JWT token\n```\n```\n'), undefined);
});
