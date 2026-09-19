import { describe, expect, it } from "vitest";

import type { RsvpRecord } from "./db";
import { groupByEvent, rollupFor } from "./rollup";

// The seed data is the UX demo's own
// (local/brainstorm/reference_event_rsvp_ux.html), so the numbers the mock
// shows and the numbers this app computes are provably the same:
//
//   e1  jtan  going 1                        (oldest)
//   e1  ana_v going 2  "we can help set up"
//   e1  kpow  can't
//   e1  ana_v can't    "sorry, sick kid"     ← ana_v changed her mind
//   e2  jtan  going 3  "bringing dumplings"
//
// Expected for e1: 1 going · 1 head · 2 can't · ana_v marked "changed".

function row(
  id: string,
  eventId: string,
  handle: string,
  status: "going" | "cant",
  party: number,
  note: string,
  createdAtMs: number,
): RsvpRecord {
  return {
    id,
    event_id: eventId,
    status,
    party,
    note,
    _submitter_handle: handle,
    _submitter_user_id: `u_${handle}`,
    _created_at_ms: createdAtMs,
    _updated_at_ms: createdAtMs,
  };
}

const SEED: RsvpRecord[] = [
  row("r1", "e1", "jtan", "going", 1, "", 3_000),
  row("r2", "e1", "ana_v", "going", 2, "we can help set up", 5_000),
  row("r3", "e1", "kpow", "cant", 0, "", 7_000),
  row("r4", "e1", "ana_v", "cant", 0, "sorry, sick kid", 9_000),
  row("r5", "e2", "jtan", "going", 3, "bringing dumplings", 4_000),
];

describe("groupByEvent", () => {
  it("buckets rows by event_id and keeps their order", () => {
    const byEvent = groupByEvent(SEED);
    expect([...byEvent.keys()].sort()).toEqual(["e1", "e2"]);
    expect(byEvent.get("e1")?.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4"]);
    expect(byEvent.get("e2")?.map((r) => r.id)).toEqual(["r5"]);
  });

  it("is empty for an event nobody answered", () => {
    expect(groupByEvent(SEED).get("e3")).toBeUndefined();
  });
});

describe("rollupFor", () => {
  const e1 = rollupFor(groupByEvent(SEED).get("e1") ?? []);

  it("keeps the latest row per handle, newest first", () => {
    // r2 is dropped: ana_v's later r4 supersedes it.
    expect(e1.latest.map((r) => r.id)).toEqual(["r4", "r3", "r1"]);
  });

  it("counts going and can't off the latest rows only", () => {
    expect(e1.going.map((r) => r._submitter_handle)).toEqual(["jtan"]);
    expect(e1.cant.map((r) => r._submitter_handle)).toEqual(["ana_v", "kpow"]);
  });

  it("sums headcount over going rows (a can't row carries 0)", () => {
    // ana_v's party of 2 does NOT count — her latest answer is "can't".
    expect(e1.headcount).toBe(1);
  });

  it("marks a handle that answered more than once", () => {
    expect([...e1.changed]).toEqual(["ana_v"]);
  });

  it("handles the single-answer event", () => {
    const e2 = rollupFor(groupByEvent(SEED).get("e2") ?? []);
    expect(e2.going).toHaveLength(1);
    expect(e2.headcount).toBe(3);
    expect(e2.cant).toHaveLength(0);
    expect(e2.changed.size).toBe(0);
  });

  it("is empty for no rows", () => {
    const none = rollupFor([]);
    expect(none.latest).toEqual([]);
    expect(none.headcount).toBe(0);
    expect(none.changed.size).toBe(0);
  });

  it("does not care what order the rows arrive in", () => {
    const shuffled = [SEED[3], SEED[0], SEED[2], SEED[1]];
    const rolled = rollupFor(shuffled);
    expect(rolled.latest.map((r) => r.id)).toEqual(["r4", "r3", "r1"]);
    expect(rolled.headcount).toBe(1);
  });

  it("breaks a same-millisecond tie deterministically", () => {
    // Two rows from one handle written in the same millisecond: whichever
    // wins must win every time, or the portal would flicker between them.
    const a = row("ra", "e9", "sam", "going", 2, "", 1_000);
    const b = row("rb", "e9", "sam", "cant", 0, "", 1_000);
    expect(rollupFor([a, b]).latest[0].id).toBe(rollupFor([b, a]).latest[0].id);
    expect(rollupFor([a, b]).changed.has("sam")).toBe(true);
  });
});
