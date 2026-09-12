// The host portal's arithmetic, as pure functions — unit-tested in
// rollup.test.ts.
//
// Why this file exists at all: an RSVP is a one-way postcard. A guest can
// write to `rsvps` but never read it back (the empty read group answers
// the uniform 404), and simple_db lets nobody but the DB owner UPDATE a
// record — so "I changed my mind" is a SECOND row, not an edit. The table
// is therefore an append-only log of answers, and the portal is what turns
// that log into "who is coming".
//
// The rule: for each event, keep the LATEST row per `_submitter_handle`
// and mark a handle that sent more than one as "changed". Everything else
// (going, can't, headcount) is derived from those latest rows.

import type { RsvpRecord } from "./db";

export interface EventRollup {
  /** Latest row per handle, newest first — the guest list as displayed. */
  latest: RsvpRecord[];
  /** Latest rows whose answer is "going". */
  going: RsvpRecord[];
  /** Latest rows whose answer is "can't". */
  cant: RsvpRecord[];
  /** Heads expected: Σ party over `going` (a `cant` row always carries 0). */
  headcount: number;
  /** Handles that answered more than once — shown with a "changed" mark. */
  changed: Set<string>;
}

/** Split a flat `rsvps` list into one bucket per `event_id`. One
 *  `listAll("rsvps")` + this beats an `eq` query per event. */
export function groupByEvent(rsvps: RsvpRecord[]): Map<string, RsvpRecord[]> {
  const byEvent = new Map<string, RsvpRecord[]>();
  for (const r of rsvps) {
    const bucket = byEvent.get(r.event_id);
    if (bucket) bucket.push(r);
    else byEvent.set(r.event_id, [r]);
  }
  return byEvent;
}

/**
 * Roll one event's rows up into what the portal shows. Input order does
 * not matter — rows are sorted newest-first here (ties broken by record
 * id so the result is stable), then deduped by handle.
 */
export function rollupFor(rows: readonly RsvpRecord[]): EventRollup {
  const newestFirst = [...rows].sort(
    (a, b) => b._created_at_ms - a._created_at_ms || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
  );

  const latestByHandle = new Map<string, RsvpRecord>();
  const seen = new Map<string, number>();
  for (const row of newestFirst) {
    const handle = row._submitter_handle;
    seen.set(handle, (seen.get(handle) ?? 0) + 1);
    // First time we meet a handle in a newest-first walk IS its latest row.
    if (!latestByHandle.has(handle)) latestByHandle.set(handle, row);
  }

  const latest = [...latestByHandle.values()];
  const going = latest.filter((r) => r.status === "going");
  const cant = latest.filter((r) => r.status === "cant");
  const changed = new Set([...seen.entries()].filter(([, n]) => n > 1).map(([handle]) => handle));

  return {
    latest,
    going,
    cant,
    headcount: going.reduce((sum, r) => sum + (Number.isFinite(r.party) ? r.party : 0), 0),
    changed,
  };
}
