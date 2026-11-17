// Small file helpers shared by everything that keeps state under .pilely/.

import { mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Written whole, then moved into place, so a crash never leaves a
// half-written file behind and a reader never sees one.
export function writeFileAtomically(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, content);
  renameSync(tmp, file);
}

const LOCK_WAIT_MS = 10_000;
const LOCK_STALE_MS = 30_000;

/**
 * Runs `action` while holding `<file>.lock`. Pam and her teammates run the
 * tools at the same time, and a read-modify-write of one JSON file must not
 * lose the other's change. A lock left behind by a killed process is taken
 * over once it is older than any honest holder would keep it.
 */
export function withFileLock<T>(file: string, action: () => T): T {
  const lock = `${file}.lock`;
  mkdirSync(dirname(file), { recursive: true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch {
      const age = Date.now() - (statSync(lock, { throwIfNoEntry: false })?.mtimeMs ?? Date.now());
      if (age > LOCK_STALE_MS) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${lock}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    return action();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

export function writeJsonAtomically(file: string, value: unknown): void {
  writeFileAtomically(file, `${JSON.stringify(value, null, 2)}\n`);
}
