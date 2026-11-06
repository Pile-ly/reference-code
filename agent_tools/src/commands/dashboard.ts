// The dashboard: a read-only page about this folder's app, served on
// 127.0.0.1 by one detached server per folder.
//
//   dashboard [--lang <code>]   start the server, or find the one running, and print its address
//   run-dashboard --port <n>    the server itself; started by dashboard
//
// `dashboard` never blocks: it prints `http://localhost:<port>/` and exits.
// The folder keeps its port in ./.pilely/dashboard/state.json, so a server
// started again after it stopped comes back on the same one; only when
// something else holds that port does it move to the next free one. The
// first port tried is 4317. `--lang` is one of the platform's language
// codes; it is remembered with the port, a run while the server runs
// replaces it, and the page reads it from its own `<meta
// name="pilely-dashboard-lang">` tag, which the server fills when it
// serves `/`.
//
// What the server answers, all GET:
//
//   /, and every file of the page folder    the page
//   /api/rooms                             every chatroom's room.json
//   /api/agents                            { <agent_id>: <type> } for the agents on file
//   /api/messages?room=<id>&after=<n>      the room's saved messages above sequence n, oldest first
//
// Anything else is a 404 and any other method a 405. Nothing else under
// .pilely/ is ever read for a request.

import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { createConnection, createServer as createNetServer } from 'node:net';
import { extname, join, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { listRooms, rawDir, requireRoomNanoid } from '../chatroom_files.ts';
import type { Context } from '../context.ts';
import { CliError, ok } from '../errors.ts';
import type { CommandResult } from '../errors.ts';
import { writeJsonAtomically } from '../files.ts';
import { parseJsonObject } from '../http.ts';
import { LANGUAGE_CODES, supportedLanguage } from '../languages.ts';
import { readWorkspaceFile } from '../workspace_file.ts';
import { stopProcess } from './listener.ts';

export const DEFAULT_PORT = 4317;
export const HOST = '127.0.0.1';
/** How far past the preferred port a free one is looked for before the system picks one. */
const PORT_SEARCH = 100;
/** How long `dashboard` waits for a server it started to answer. */
const READY_WAIT_MS = 3_000;

const USAGE = `usage: pilely workspace dashboard [--lang <code>]   (<code>: ${LANGUAGE_CODES.join(', ')})`;

/** What the folder remembers about its dashboard. */
export interface DashboardState {
  port?: number;
  /** The language Pam started the page with; empty when none was given. */
  lang?: string;
}

const stateFile = (ctx: Context) => join(ctx.config.dashboardDir, 'state.json');
const pidFile = (ctx: Context) => join(ctx.config.dashboardDir, 'server.pid');
const logFile = (ctx: Context) => join(ctx.config.dashboardDir, 'server.log');

export function readDashboardState(ctx: Context): DashboardState {
  const file = stateFile(ctx);
  const json = existsSync(file) ? parseJsonObject(readFileSync(file, 'utf8')) : undefined;
  const port = Number(json?.port);
  return {
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : undefined,
    lang: typeof json?.lang === 'string' ? supportedLanguage(json.lang) : undefined,
  };
}

function writeDashboardState(ctx: Context, state: DashboardState): void {
  writeJsonAtomically(stateFile(ctx), { port: state.port ?? null, lang: state.lang ?? '' });
}

// ---- the command ----

function parseLang(args: string[]): string | undefined {
  if (args.length === 0) return undefined;
  if (args.length !== 2 || args[0] !== '--lang') throw new CliError(USAGE);
  const code = supportedLanguage(args[1]!);
  if (!code) throw new CliError(`not a supported language code: ${args[1]}\n${USAGE}`);
  return code;
}

/**
 * True only when `pid` is a dashboard server. A pid file outlives a crash
 * and the system reuses pids, so a live pid alone is never trusted.
 */
function isDashboardProcess(pid: number): boolean {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).includes('run-dashboard');
  } catch {
    return false;
  }
}

function runningPid(ctx: Context): number | undefined {
  const file = pidFile(ctx);
  if (!existsSync(file)) return undefined;
  const pid = Number(readFileSync(file, 'utf8').trim());
  if (Number.isInteger(pid) && pid > 0 && isDashboardProcess(pid)) return pid;
  rmSync(file, { force: true });
  return undefined;
}

/** True when something accepts a connection on 127.0.0.1:`port`. */
function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: HOST, port });
    socket.setTimeout(500);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createNetServer();
    probe.once('error', () => resolve(false));
    probe.listen({ host: HOST, port, exclusive: true }, () => probe.close(() => resolve(true)));
  });
}

async function isFree(port: number): Promise<boolean> {
  return !(await answers(port)) && (await canBind(port));
}

/** `preferred` when nothing holds it, else the next free port above it, else 0 when none is free. */
export async function choosePort(preferred: number): Promise<number> {
  for (let port = preferred; port < Math.min(preferred + PORT_SEARCH, 65536); port++) {
    if (await isFree(port)) return port;
  }
  return 0;
}

const address = (port: number) => `http://localhost:${port}/`;

async function dashboard(ctx: Context, lang: string | undefined, entryPoint: string): Promise<CommandResult> {
  const state = readDashboardState(ctx);
  const nextState: DashboardState = { port: state.port, lang: lang ?? state.lang };

  const running = runningPid(ctx);
  if (running && state.port) {
    writeDashboardState(ctx, nextState);
    return ok(`${address(state.port)}\n`);
  }
  // A server whose port is not on file cannot be pointed at; replace it.
  if (running) {
    await stopProcess(running, () => isDashboardProcess(running));
    rmSync(pidFile(ctx), { force: true });
  }

  mkdirSync(ctx.config.dashboardDir, { recursive: true });
  // Claim the pid file before starting anything: of two runs racing to
  // start a server, exactly one creates the file; the other reports the
  // winner's address.
  let claim: number;
  try {
    claim = openSync(pidFile(ctx), 'wx');
  } catch {
    const winner = readDashboardState(ctx);
    if (!winner.port) throw new CliError('another dashboard server is starting; run the command again');
    return ok(`${address(winner.port)}\n`);
  }
  let pid: number;
  let port: number;
  try {
    port = await choosePort(state.port ?? DEFAULT_PORT);
    if (port === 0) throw new CliError(`no free port from ${state.port ?? DEFAULT_PORT} on`);
    writeDashboardState(ctx, { ...nextState, port });
    const log = openSync(logFile(ctx), 'a');
    const child = spawn(process.execPath, [entryPoint, 'workspace', 'run-dashboard', '--port', String(port)], {
      detached: true,
      stdio: ['ignore', log, log],
      cwd: process.cwd(),
      env: process.env,
    });
    closeSync(log);
    if (!child.pid) throw new CliError('unable to start the dashboard server');
    pid = child.pid;
    writeFileSync(claim, `${pid}\n`);
    child.unref();
  } catch (error) {
    rmSync(pidFile(ctx), { force: true });
    throw error;
  } finally {
    closeSync(claim);
  }

  for (const deadline = Date.now() + READY_WAIT_MS; Date.now() < deadline && !(await answers(port)); ) {
    if (!isDashboardProcess(pid)) {
      rmSync(pidFile(ctx), { force: true });
      throw new CliError(`the dashboard server stopped right after it started; see ${logFile(ctx)}`);
    }
    await sleep(100);
  }
  return ok(`${address(port)}\n`);
}

// ---- the server ----

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const LANG_META = /(<meta\s+name="pilely-dashboard-lang"\s+content=")[^"]*(")/;

function send(response: ServerResponse, status: number, type: string, body: string | Buffer): void {
  response.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

const sendJson = (response: ServerResponse, value: unknown) =>
  send(response, 200, CONTENT_TYPES['.json']!, `${JSON.stringify(value)}\n`);
const notFound = (response: ServerResponse) => send(response, 404, CONTENT_TYPES['.txt']!, 'not found\n');

function agentTypes(ctx: Context): Record<string, string> {
  let agents;
  try {
    agents = readWorkspaceFile(ctx)?.agents ?? {};
  } catch {
    return {};
  }
  const types: Record<string, string> = {};
  for (const agent of Object.values(agents)) {
    if (typeof agent.agent_id === 'string' && typeof agent.type === 'string') types[agent.agent_id] = agent.type;
  }
  return types;
}

/** The saved messages of `room` above `after`, oldest first; none for a room with no files. */
function messagesAfter(ctx: Context, room: string, after: number): Record<string, unknown>[] {
  const dir = rawDir(ctx, room);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^\d{10}\.json$/.test(name))
    .map((name) => ({ name, sequence: Number(name.slice(0, 10)) }))
    .filter((entry) => entry.sequence > after)
    .sort((a, b) => a.sequence - b.sequence)
    .flatMap((entry) => {
      const message = parseJsonObject(readFileSync(join(dir, entry.name), 'utf8'));
      return message ? [message] : [];
    });
}

/**
 * The file of the page folder that `pathname` names, or undefined. Only
 * plain segments are accepted — no `..`, no hidden names, no backslash —
 * and the resolved file must still sit inside the folder after links are
 * followed.
 */
function pageFile(ctx: Context, pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  const relative = decoded === '/' ? 'index.html' : decoded.slice(1);
  const segments = relative.split('/');
  if (segments.some((segment) => segment === '' || segment.startsWith('.') || /[\\\0]/.test(segment))) return undefined;
  if (!CONTENT_TYPES[extname(relative).toLowerCase()]) return undefined;
  try {
    const root = realpathSync(ctx.config.dashboardPageDir);
    const file = realpathSync(join(root, ...segments));
    if (!file.startsWith(root + sep) || !statSync(file).isFile()) return undefined;
    return file;
  } catch {
    return undefined;
  }
}

function servePage(ctx: Context, pathname: string, response: ServerResponse): void {
  const file = pageFile(ctx, pathname);
  if (!file) return notFound(response);
  const type = CONTENT_TYPES[extname(file).toLowerCase()]!;
  if (pathname !== '/') return send(response, 200, type, readFileSync(file));
  const lang = readDashboardState(ctx).lang ?? '';
  send(response, 200, type, readFileSync(file, 'utf8').replace(LANG_META, `$1${lang}$2`));
}

/** True for a Host header naming this machine by loopback, so a page on another site cannot read the answers through a rebound name. */
function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, '').toLowerCase();
  return name === 'localhost' || name === HOST;
}

export function handleRequest(ctx: Context, request: IncomingMessage, response: ServerResponse): void {
  try {
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      return send(response, 405, CONTENT_TYPES['.txt']!, 'method not allowed\n');
    }
    if (!isLoopbackHost(request.headers.host)) return notFound(response);
    const url = new URL(request.url ?? '/', 'http://localhost');
    switch (url.pathname) {
      case '/api/rooms':
        return sendJson(response, listRooms(ctx));
      case '/api/agents':
        return sendJson(response, agentTypes(ctx));
      case '/api/messages': {
        const room = url.searchParams.get('room') ?? '';
        const after = url.searchParams.get('after') ?? '0';
        if (!/^\d{1,15}$/.test(after)) return notFound(response);
        try {
          requireRoomNanoid(room);
        } catch {
          return notFound(response);
        }
        return sendJson(response, messagesAfter(ctx, room, Number(after)));
      }
      default:
        if (url.pathname.startsWith('/api/')) return notFound(response);
        return servePage(ctx, url.pathname, response);
    }
  } catch {
    send(response, 500, CONTENT_TYPES['.txt']!, 'server error\n');
  }
}

/** Starts the server on 127.0.0.1:`port` (0: any free port); resolves once it listens. */
export function serveDashboard(ctx: Context, port: number): Promise<Server> {
  const server = createServer((request, response) => handleRequest(ctx, request, response));
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: HOST, port, exclusive: true }, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

/** Removes the pid file, but only when it still names this process. */
function releasePidFile(ctx: Context): void {
  const file = pidFile(ctx);
  if (existsSync(file) && Number(readFileSync(file, 'utf8').trim()) === process.pid) rmSync(file, { force: true });
}

async function runDashboard(ctx: Context, port: number): Promise<CommandResult> {
  const exit = (reason: string) => {
    process.stderr.write(`${new Date().toISOString()} dashboard server stopped: ${reason}\n`);
    releasePidFile(ctx);
    process.exit(0);
  };
  process.on('SIGTERM', () => exit('stop requested'));
  process.on('SIGINT', () => exit('stop requested'));
  try {
    await serveDashboard(ctx, port);
  } catch (error) {
    exit(`cannot listen on ${HOST}:${port}: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.stderr.write(`${new Date().toISOString()} dashboard server listening on ${HOST}:${port}\n`);
  return new Promise<CommandResult>(() => {});
}

export async function dashboardCommand(
  ctx: Context,
  command: string,
  args: string[],
  entryPoint: string,
): Promise<CommandResult | undefined> {
  switch (command) {
    case 'dashboard':
      return dashboard(ctx, parseLang(args), entryPoint);
    case 'run-dashboard': {
      const port = Number(args[1]);
      if (args.length !== 2 || args[0] !== '--port' || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new CliError('usage: pilely workspace run-dashboard --port <n>');
      }
      return runDashboard(ctx, port);
    }
    default:
      return undefined;
  }
}
