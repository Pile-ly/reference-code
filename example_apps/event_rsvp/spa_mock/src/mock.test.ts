import { beforeEach, describe, expect, it, vi } from "vitest";
import { addEvent, latestForEvent, resetFixtures, rollup, submitRsvp } from "./mock";

describe("API-free RSVP mock", () => {
  beforeEach(() => {
    // A regression must not quietly introduce platform or HTTP calls.
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network forbidden"); }));
    vi.stubGlobal("XMLHttpRequest", class { constructor() { throw new Error("network forbidden"); } });
  });
  it("resets independent fixtures", () => { const a = resetFixtures(); const b = resetFixtures(); a.events.pop(); expect(b.events).toHaveLength(7); });
  it("keeps only each guest's latest answer in the host roll-up", () => {
    let state = resetFixtures(); state = submitRsvp(state, { eventId: "supper", handle: "maya", status: "cant", party: 0, note: "Changed plans" });
    expect(latestForEvent(state, "supper")).toMatchObject([{ handle: "leo", status: "cant" }, { handle: "maya", status: "cant" }]);
    expect(rollup(state, "supper")).toMatchObject({ heads: 0, going: [], cant: expect.any(Array) });
  });
  it("supports host event creation without a request", () => expect(addEvent(resetFixtures(), { title: "Brunch", starts_at_ms: 1, tz: "UTC", place: "Home", description: "", }).events).toHaveLength(8));
});
