// "You RSVP'd on this device" — a localStorage memo, and the honest way to
// show a guest their own answer.
//
// The dishonest way would be to read it back from the server. You can't:
// `rsvps` has an empty read group, so a guest's `list`/`get` answers the
// uniform 404 — the write is a one-way postcard. What the app CAN
// truthfully say is "this browser sent one", so that is exactly what the
// copy says, per-device caveat included.
//
// The handle is part of the key: two accounts sharing a laptop must not
// read each other's memos, and signing out then in as someone else must
// not show the wrong answer.

import type { RsvpStatus } from "./db";

export interface RsvpMemo {
  status: RsvpStatus;
  /** Heads sent with the answer; 0 for "can't". */
  party: number;
  /** When this device sent it (epoch ms) — the memo's own clock, not the
   *  server's, since the server's copy is unreadable to us. */
  at: number;
}

/** Minimal shape of what we use — lets tests pass a fake. */
export interface MemoStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function memoKey(handle: string, eventId: string): string {
  return `event_rsvp:memo:${handle}:${eventId}`;
}

/** localStorage, or null where it is unavailable (private mode, embeds).
 *  Every call site degrades to "no memo" rather than throwing. */
function defaultStorage(): MemoStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readMemo(
  handle: string,
  eventId: string,
  storage: MemoStorage | null = defaultStorage(),
): RsvpMemo | null {
  if (!storage || !handle) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(memoKey(handle, eventId));
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RsvpMemo>;
    if (parsed.status !== "going" && parsed.status !== "cant") return null;
    return {
      status: parsed.status,
      party: typeof parsed.party === "number" ? parsed.party : 0,
      at: typeof parsed.at === "number" ? parsed.at : 0,
    };
  } catch {
    // Corrupt entry (hand-edited, or a future version's shape) — treat it
    // as absent rather than break the page.
    return null;
  }
}

export function writeMemo(
  handle: string,
  eventId: string,
  memo: RsvpMemo,
  storage: MemoStorage | null = defaultStorage(),
): void {
  if (!storage || !handle) return;
  try {
    storage.setItem(memoKey(handle, eventId), JSON.stringify(memo));
  } catch {
    // Quota or private mode — the RSVP still went through; only the local
    // reminder is lost.
  }
}

/** Used when the host deletes an event: the memo for a gone event is
 *  noise. Best-effort, like everything else here. */
export function clearMemo(
  handle: string,
  eventId: string,
  storage: MemoStorage | null = defaultStorage(),
): void {
  if (!storage || !handle) return;
  try {
    storage.removeItem(memoKey(handle, eventId));
  } catch {
    // nothing to do
  }
}
