import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addPlant, addWatering, currentUser, removePlant, removeWatering, resetMockData, signIn, signOut, snapshot } from "./mock";

describe("API-free mock", () => {
  beforeEach(() => {
    resetMockData();
    vi.stubGlobal("fetch", () => { throw new Error("network is forbidden in the mock"); });
    vi.stubGlobal("XMLHttpRequest", class { constructor() { throw new Error("network is forbidden in the mock"); } });
  });
  afterEach(() => { vi.unstubAllGlobals(); resetMockData(); });

  it("keeps records behind the signed-out and non-owner gates", () => {
    expect(snapshot().plants).toEqual([]);
    signIn("other");
    expect(snapshot().waterings).toEqual([]);
    signIn();
    expect(snapshot().plants).toHaveLength(8);
  });

  it("adds waterings, supports undo deletion, and resets fixtures", () => {
    signIn();
    const watering = addWatering("plant-1", "testing");
    expect(snapshot().waterings[0]).toMatchObject({ id: watering.id, note: "testing" });
    removeWatering(watering.id);
    expect(snapshot().waterings.map((item) => item.id)).not.toContain(watering.id);
    resetMockData();
    expect(currentUser()).toBeNull();
    expect(snapshot().plants).toEqual([]);
  });

  it("cascades history when a plant is deleted", () => {
    signIn();
    const plant = addPlant("Fern");
    addWatering(plant.id, "new leaf");
    removePlant(plant.id);
    expect(snapshot().plants.map((item) => item.id)).not.toContain(plant.id);
    expect(snapshot().waterings.some((item) => item.plantId === plant.id)).toBe(false);
    signOut();
  });
});
