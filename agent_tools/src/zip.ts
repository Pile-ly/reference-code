// Reads a zip archive held in memory, with node built-ins only: the
// central directory names every entry, each entry's data is Stored or
// Deflated (node:zlib), and its CRC-32 and size are checked. Every name is
// a relative path that stays inside the folder it is extracted to; an
// archive with any other name, an encrypted entry, another compression
// method or ZIP64 sizes is refused whole, before anything is written.

import { crc32, inflateRawSync } from 'node:zlib';
import { CliError } from './errors.ts';

export interface ZipEntry {
  /** The entry's relative path, `/`-separated. */
  path: string;
  data: Uint8Array;
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const END_RECORD_SIZE = 22;
const MAX_COMMENT = 0xffff;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;
const FLAG_ENCRYPTED = 0x0001;
const ZIP64_MARKER = 0xffffffff;

/** Every file entry of `zip` (directory entries are left out), in archive order. */
export function readZip(zip: Uint8Array): ZipEntry[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = findEndRecord(view);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < count; i++) {
    need(view, at, 46);
    if (view.getUint32(at, true) !== CENTRAL_DIRECTORY_ENTRY) bad('a central directory entry is missing');
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressedSize = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    need(view, at + 46, nameLength);
    const name = new TextDecoder('utf-8', { fatal: true }).decode(zip.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) {
      safePath(name.slice(0, -1));
      continue;
    }
    const path = safePath(name);
    if (seen.has(path)) bad(`the entry ${path} appears twice`);
    seen.add(path);
    if (flags & FLAG_ENCRYPTED) bad(`the entry ${path} is encrypted`);
    if (compressedSize === ZIP64_MARKER || size === ZIP64_MARKER || localOffset === ZIP64_MARKER) {
      bad(`the entry ${path} uses ZIP64, which is not supported`);
    }

    need(view, localOffset, 30);
    if (view.getUint32(localOffset, true) !== LOCAL_FILE_HEADER) bad(`the entry ${path} has no local header`);
    const dataStart = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    need(view, dataStart, compressedSize);
    const raw = zip.subarray(dataStart, dataStart + compressedSize);

    let data: Uint8Array;
    if (method === METHOD_STORED) data = raw;
    else if (method === METHOD_DEFLATED) data = inflate(raw, size, path);
    else bad(`the entry ${path} uses compression method ${method}; only Stored and Deflated are read`);
    if (data.byteLength !== size) bad(`the entry ${path} is ${data.byteLength} bytes, not the ${size} it declares`);
    if (crc32(data) !== crc) bad(`the entry ${path} fails its CRC-32 check`);
    entries.push({ path, data });
  }
  return entries;
}

function findEndRecord(view: DataView): number {
  const lowest = Math.max(0, view.byteLength - END_RECORD_SIZE - MAX_COMMENT);
  for (let at = view.byteLength - END_RECORD_SIZE; at >= lowest; at--) {
    if (view.getUint32(at, true) === END_OF_CENTRAL_DIRECTORY) return at;
  }
  return bad('not a zip archive');
}

function inflate(raw: Uint8Array, size: number, path: string): Uint8Array {
  try {
    // `maxOutputLength` caps what a hostile entry could expand to.
    return inflateRawSync(raw, { maxOutputLength: Math.max(size, 1) });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    return bad(`the entry ${path} does not inflate: ${reason}`);
  }
}

/**
 * The entry name as a relative path that cannot leave the folder it is
 * extracted to: no absolute path, no drive letter, no backslash, no empty,
 * `.` or `..` segment.
 */
function safePath(name: string): string {
  const segments = name.split('/');
  const escapes =
    name === '' ||
    name.includes('\\') ||
    name.includes('\0') ||
    /^[A-Za-z]:/.test(name) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..');
  if (escapes) bad(`the entry name ${JSON.stringify(name)} is not a safe relative path`);
  return name;
}

function need(view: DataView, at: number, length: number): void {
  if (at < 0 || at + length > view.byteLength) bad('the archive is truncated');
}

function bad(reason: string): never {
  throw new CliError(`unreadable zip: ${reason}`);
}
