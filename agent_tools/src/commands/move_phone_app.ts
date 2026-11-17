// pilely workspace move-phone-app — moves an app built on the phone
// (through the mcp.pilely.app connector) into this folder, one way.
//
//   pilely workspace move-phone-app <app> [--folder <app folder>]
//
// <app> is the pile id or the host label of one of the user's own apps;
// either is looked up in the user's app list (`/~/apps/list`), which also
// gives the host label the folder is named after unless --folder names
// another. The target `apps/<app folder>/` must be missing or empty, and is
// checked before anything is moved.
//
// Then, with the user's login: `/~/apps/{pile_id}/move_cloud_code_to_local`
// moves the app and answers its source snapshot; `source_bundle_management/
// download` fetches that snapshot's zip; the zip's files land in
// `apps/<app folder>/app/`, and its `_pilely_app_note.md` at
// `apps/<app folder>/app_note.md`. The files are written to a staging
// folder first and moved into place whole, so a failure leaves no
// half-filled app folder. Running it again on a moved app answers the same
// snapshot, so it re-downloads the same files.

import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { Context } from '../context.ts';
import { CliError, ok } from '../errors.ts';
import type { CommandResult } from '../errors.ts';
import { isSuccess, parseJsonObject, stringField } from '../http.ts';
import type { HttpResponse } from '../http.ts';
import { pilelyRequest } from '../pilely_request.ts';
import { readZip } from '../zip.ts';

const USAGE = 'usage: pilely workspace move-phone-app <pile id or host label> [--folder <app folder>]';

/** The note's name inside the snapshot zip, and where it lands in the app folder. */
export const SNAPSHOT_NOTE_PATH = '_pilely_app_note.md';
export const APP_NOTE_FILE = 'app_note.md';

const PILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** An app folder name: lowercase words joined by hyphens, as a host label is. */
const FOLDER = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

interface OwnApp {
  pileId: string;
  label: string | undefined;
}

export async function movePhoneAppCommand(ctx: Context, args: string[]): Promise<CommandResult> {
  let app: string | undefined;
  let folder: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--folder') folder = args[++i] ?? '';
    else if (app === undefined && !args[i]!.startsWith('--')) app = args[i];
    else throw new CliError(USAGE);
  }
  if (!app) throw new CliError(USAGE);
  if (folder !== undefined && !FOLDER.test(folder)) {
    throw new CliError(`not an app folder name: ${JSON.stringify(folder)} (lowercase words joined by hyphens)`);
  }

  const own = await findOwnApp(ctx, app);
  const name = folder ?? own.label;
  if (!name || !FOLDER.test(name)) {
    throw new CliError(`the app has no host label to name its folder after; name one with --folder <app folder>`);
  }
  const target = join(ctx.config.appsDir, name);
  requireEmptyFolder(target, name);

  const moved = await moveApp(ctx, own.pileId);
  const zip = await downloadSnapshot(ctx, own.pileId, moved.receivedMs);
  const written = extractInto(ctx, zip, target);

  return ok(
    `${JSON.stringify(
      {
        pile_id: own.pileId,
        host: moved.host,
        moved_at: moved.movedAt,
        snapshot: moved.snapshot,
        folder: `apps/${name}/`,
        files: written.files,
        app_note: written.note ? `apps/${name}/${APP_NOTE_FILE}` : null,
      },
      null,
      2,
    )}\n`,
  );
}

/** The user's own app named by pile id or host label, from every page of `/~/apps/list`. */
async function findOwnApp(ctx: Context, app: string): Promise<OwnApp> {
  const wanted = app.toLowerCase();
  const byId = PILE_ID.test(app);
  let cursor: string | undefined;
  for (;;) {
    const response = await pilelyRequest(ctx, {
      method: 'POST',
      url: `${ctx.config.apexBaseUrl}/~/apps/list`,
      jsonBody: cursor ? JSON.stringify({ cursor }) : undefined,
    });
    if (!isSuccess(response.status)) fail('listing your apps', response);
    const body = parseJsonObject(response.body);
    const piles = Array.isArray(body?.piles) ? (body.piles as unknown[]) : [];
    for (const pile of piles) {
      const fields = pile !== null && typeof pile === 'object' ? (pile as Record<string, unknown>) : undefined;
      const pileId = stringField(fields, 'pile_id');
      const label = stringField(fields, 'dns_label');
      if (!pileId) continue;
      if (byId ? pileId.toLowerCase() === wanted : label?.toLowerCase() === wanted) return { pileId, label };
    }
    cursor = stringField(body, 'next_cursor');
    if (!cursor) break;
  }
  throw new CliError(`no app of yours has the ${byId ? 'pile id' : 'host label'} ${app}`);
}

function requireEmptyFolder(target: string, name: string): void {
  const stat = statSync(target, { throwIfNoEntry: false });
  if (!stat) return;
  if (!stat.isDirectory() || readdirSync(target).length > 0) {
    throw new CliError(`apps/${name}/ already holds files; an app moves only into an empty folder`);
  }
}

interface Moved {
  host: string | null;
  movedAt: unknown;
  snapshot: Record<string, unknown>;
  receivedMs: number;
}

async function moveApp(ctx: Context, pileId: string): Promise<Moved> {
  const response = await pilelyRequest(ctx, {
    method: 'POST',
    url: `${ctx.config.apexBaseUrl}/~/apps/${pileId}/move_cloud_code_to_local`,
  });
  if (!isSuccess(response.status)) fail('the move', response);
  const body = parseJsonObject(response.body);
  const snapshot = body?.snapshot;
  const fields = snapshot !== null && typeof snapshot === 'object' ? (snapshot as Record<string, unknown>) : undefined;
  const receivedMs = fields?.received_ms;
  if (!fields || typeof receivedMs !== 'number' || !Number.isSafeInteger(receivedMs) || receivedMs <= 0) {
    throw new CliError(`the move answered no snapshot version: ${response.body}`);
  }
  return { host: stringField(body, 'host') ?? null, movedAt: body?.moved_at ?? null, snapshot: fields, receivedMs };
}

async function downloadSnapshot(ctx: Context, pileId: string, version: number): Promise<Uint8Array> {
  const response = await pilelyRequest(ctx, {
    method: 'POST',
    url: `${ctx.config.apexBaseUrl}/~/apps/${pileId}/source_bundle_management/download`,
    jsonBody: JSON.stringify({ version }),
    binary: true,
  });
  if (!isSuccess(response.status)) fail('the snapshot download', response);
  if (!response.bytes) throw new CliError('the snapshot download answered no zip');
  return response.bytes;
}

/** Writes the snapshot into `target`: its files under `app/`, its note as `app_note.md`. */
function extractInto(ctx: Context, zip: Uint8Array, target: string): { files: number; note: boolean } {
  const entries = readZip(zip);
  const staging = join(dirname(target), `.${basename(target)}.move-${process.pid}`);
  rmSync(staging, { recursive: true, force: true });
  let files = 0;
  let note = false;
  try {
    mkdirSync(join(staging, 'app'), { recursive: true });
    for (const entry of entries) {
      const file = entry.path === SNAPSHOT_NOTE_PATH ? join(staging, APP_NOTE_FILE) : join(staging, 'app', entry.path);
      if (entry.path === SNAPSHOT_NOTE_PATH) note = true;
      else files++;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, entry.data);
    }
    if (existsSync(target)) rmdirSync(target);
    renameSync(staging, target);
  } catch (cause) {
    rmSync(staging, { recursive: true, force: true });
    throw cause;
  }
  if (!note) ctx.note('the snapshot carried no app note');
  return { files, note };
}

/** A refusal from root, as a CLI error: its status, code and plain reason. */
function fail(what: string, response: HttpResponse): never {
  const body = parseJsonObject(response.body);
  const code = stringField(body, 'code');
  const reason = stringField(body, 'reason');
  const detail = code || reason ? `${code ?? 'error'}: ${reason ?? ''}`.trim() : response.body;
  throw new CliError(`${what} failed (http ${response.status}) ${detail}`);
}
