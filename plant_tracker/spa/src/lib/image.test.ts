import { describe, expect, it } from "vitest";

import { fitWithin } from "./image";

// Only the pure geometry is unit-tested (vitest runs in node — no canvas);
// the decode/encode path is exercised in the browser.
describe("fitWithin", () => {
  it("caps the longest edge and keeps aspect", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ w: 1600, h: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ w: 1200, h: 1600 });
  });

  it("never upscales", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ w: 800, h: 600 });
  });

  it("rounds to whole pixels", () => {
    // 3024×4032 (a common phone sensor) at maxEdge 1600 → scale 1600/4032.
    expect(fitWithin(3024, 4032, 1600)).toEqual({ w: 1200, h: 1600 });
    expect(fitWithin(1001, 3000, 1600)).toEqual({ w: 534, h: 1600 });
  });
});
