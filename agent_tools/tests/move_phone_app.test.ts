import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { crc32, deflateRawSync } from 'node:zlib';
import { writeAccountEmail } from '../src/account.ts';
import { workspaceCommand } from '../src/commands/workspace.ts';
import type { HttpRequest, HttpResponse } from '../src/http.ts';
import { readZip } from '../src/zip.ts';
import { testContext } from './helpers.ts';

const EMAIL = 'user@example.com';
const PILE_ID = '0b7c1d2e-3f40-4a5b-8c6d-7e8f90a1b2c3';
const RECEIVED_MS = 1793000000123;
const NOTE = '# Plant watering tracker\n\nDecided: weekly reminders.\n';

/** A zip built here, entry by entry: `deflate` picks Deflated over Stored. */
function buildZip(files: { name: string; content: string; deflate?: boolean }[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.from(file.content, 'utf8');
    const stored = file.deflate ? deflateRawSync(data) : data;
    const method = file.deflate ? 8 : 0;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(stored.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, stored);
    centrals.push(central, name);
    offset += local.length + name.length + stored.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const SNAPSHOT = buildZip([
  { name: 'package.json', content: '{"name":"plant-watering-tracker"}\n' },
  { name: 'src/main.tsx', content: 'export const app = "plants";\n'.repeat(20), deflate: true },
  { name: 'src/components/', content: '' },
  { name: '_pilely_app_note.md', content: NOTE, deflate: true },
]);

const LIST = JSON.stringify({
  ok: true,
  piles: [
    { pile_id: '11111111-2222-4333-8444-555555555555', host: 'other.pilely.app', dns_label: 'other' },
    { pile_id: PILE_ID, host: 'plant-watering-tracker.pilely.app', dns_label: 'plant-watering-tracker' },
  ],
  next_cursor: null,
});

const MOVED = JSON.stringify({
  ok: true,
  pile_id: PILE_ID,
  host: 'plant-watering-tracker.pilely.app',
  moved_at: '2026-11-02T10:00:00Z',
  snapshot: { received_ms: RECEIVED_MS, size_bytes: SNAPSHOT.byteLength },
});

/** Root as the move sees it; `move` overrides the move route's answer. */
function root(move: HttpResponse = { status: 200, body: MOVED }) {
  return (request: HttpRequest): HttpResponse => {
    if (request.url.endsWith('/~/apps/list')) return { status: 200, body: LIST };
    if (request.url.endsWith('/move_cloud_code_to_local')) return move;
    if (request.url.endsWith('/source_bundle_management/download')) {
      return { status: 200, body: '', bytes: SNAPSHOT };
    }
    return { status: 404, body: '{"ok":false,"code":"not_found","reason":"no such route"}' };
  };
}

function loggedIn(respond: Parameters<typeof testContext>[0]) {
  const ctx = testContext(respond);
  writeAccountEmail(ctx, EMAIL);
  ctx.secrets.set(`pile.ly/${EMAIL}`, 'LOGIN');
  return ctx;
}

test('move-phone-app lands the source in apps/<label>/app/ and the note at app_note.md, with the session', async () => {
  const ctx = loggedIn(root());
  const result = await workspaceCommand(ctx, ['move-phone-app', 'plant-watering-tracker']);
  assert.equal(result.exitCode, 0);
  const out = JSON.parse(result.stdout);
  assert.equal(out.pile_id, PILE_ID);
  assert.equal(out.folder, 'apps/plant-watering-tracker/');
  assert.equal(out.files, 2);
  assert.equal(out.app_note, 'apps/plant-watering-tracker/app_note.md');
  assert.deepEqual(out.snapshot, { received_ms: RECEIVED_MS, size_bytes: SNAPSHOT.byteLength });

  const folder = join(ctx.config.appsDir, 'plant-watering-tracker');
  assert.equal(readFileSync(join(folder, 'app', 'package.json'), 'utf8'), '{"name":"plant-watering-tracker"}\n');
  assert.equal(readFileSync(join(folder, 'app', 'src', 'main.tsx'), 'utf8'), 'export const app = "plants";\n'.repeat(20));
  assert.equal(readFileSync(join(folder, 'app_note.md'), 'utf8'), NOTE);
  assert.ok(!existsSync(join(folder, 'app', '_pilely_app_note.md')));
  assert.deepEqual(readdirSync(ctx.config.appsDir), ['plant-watering-tracker']);

  assert.deepEqual(
    ctx.requests.map((r) => r.url),
    [
      'https://pilely.app/~/apps/list',
      `https://pilely.app/~/apps/${PILE_ID}/move_cloud_code_to_local`,
      `https://pilely.app/~/apps/${PILE_ID}/source_bundle_management/download`,
    ],
  );
  for (const request of ctx.requests) {
    assert.equal(request.method, 'POST');
    assert.equal(request.headers!.Authorization, 'Bearer LOGIN');
  }
  assert.deepEqual(JSON.parse(ctx.requests[2]!.body!), { version: RECEIVED_MS });
  assert.equal(ctx.requests[2]!.binary, true);
});

test('a second run on a moved app re-downloads the same snapshot version', async () => {
  const ctx = loggedIn(root());
  await workspaceCommand(ctx, ['move-phone-app', PILE_ID]);
  rmSync(join(ctx.config.appsDir, 'plant-watering-tracker'), { recursive: true });
  const again = await workspaceCommand(ctx, ['move-phone-app', PILE_ID, '--folder', 'plants']);
  assert.equal(JSON.parse(again.stdout).folder, 'apps/plants/');
  assert.equal(readFileSync(join(ctx.config.appsDir, 'plants', 'app_note.md'), 'utf8'), NOTE);
  const downloads = ctx.requests.filter((r) => r.url.endsWith('/download'));
  assert.equal(downloads.length, 2);
  assert.deepEqual(
    downloads.map((r) => JSON.parse(r.body!)),
    [{ version: RECEIVED_MS }, { version: RECEIVED_MS }],
  );
});

test('an app folder that already holds files is refused before anything moves', async () => {
  const ctx = loggedIn(root());
  const folder = join(ctx.config.appsDir, 'plant-watering-tracker');
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'notes.txt'), 'mine');
  await assert.rejects(workspaceCommand(ctx, ['move-phone-app', 'plant-watering-tracker']), /already holds files/);
  assert.ok(!ctx.requests.some((r) => r.url.endsWith('/move_cloud_code_to_local')));
  assert.deepEqual(readdirSync(folder), ['notes.txt']);

  // An empty folder is taken.
  rmSync(join(folder, 'notes.txt'));
  await workspaceCommand(ctx, ['move-phone-app', 'plant-watering-tracker']);
  assert.ok(existsSync(join(folder, 'app_note.md')));
});

test("root's 404 and 409 surface as CLI errors and write nothing", async () => {
  const notFound = loggedIn(
    root({ status: 404, body: '{"ok":false,"code":"not_found","reason":"No such app."}' }),
  );
  await assert.rejects(workspaceCommand(notFound, ['move-phone-app', PILE_ID]), /http 404\) not_found: No such app\./);
  assert.ok(!existsSync(notFound.config.appsDir));

  const building = loggedIn(
    root({ status: 409, body: '{"ok":false,"code":"build_in_progress","reason":"A build is running."}' }),
  );
  await assert.rejects(
    workspaceCommand(building, ['move-phone-app', 'plant-watering-tracker']),
    /http 409\) build_in_progress: A build is running\./,
  );
  assert.ok(!building.requests.some((r) => r.url.endsWith('/download')));
  assert.ok(!existsSync(building.config.appsDir));
});

test('an app that is not one of yours is refused before the move', async () => {
  const ctx = loggedIn(root());
  await assert.rejects(workspaceCommand(ctx, ['move-phone-app', 'someone-elses']), /no app of yours/);
  assert.equal(ctx.requests.length, 1);
});

test('usage and folder names', async () => {
  const ctx = loggedIn(root());
  await assert.rejects(workspaceCommand(ctx, ['move-phone-app']), /usage:/);
  await assert.rejects(workspaceCommand(ctx, ['move-phone-app', 'a', 'b']), /usage:/);
  await assert.rejects(workspaceCommand(ctx, ['move-phone-app', 'a', '--folder', '../up']), /not an app folder name/);
  assert.equal(ctx.requests.length, 0);
});

test('readZip refuses entries that escape the folder, and reads Stored and Deflated', () => {
  assert.deepEqual(
    readZip(SNAPSHOT).map((e) => e.path),
    ['package.json', 'src/main.tsx', '_pilely_app_note.md'],
  );
  for (const name of ['../evil.txt', '/etc/passwd', 'a/../../b', 'a\\b', 'C:/x', 'a//b']) {
    assert.throws(() => readZip(buildZip([{ name, content: 'x' }])), /not a safe relative path/, name);
  }
  assert.throws(() => readZip(new Uint8Array([1, 2, 3])), /not a zip archive/);
});

test('a snapshot that does not unzip writes nothing', async () => {
  const ctx = loggedIn((request) => {
    if (request.url.endsWith('/download')) return { status: 200, body: '', bytes: buildZip([{ name: '../x', content: 'x' }]) };
    return root()(request);
  });
  await assert.rejects(workspaceCommand(ctx, ['move-phone-app', PILE_ID]), /not a safe relative path/);
  assert.ok(!existsSync(join(ctx.config.appsDir, 'plant-watering-tracker')));
});
