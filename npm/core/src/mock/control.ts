import { isMockMode } from "./flag.js";
import { allMockServices, disposeMockServices } from "./registry.js";
import type { MockSeed } from "./registry.js";
import { clearState, readState, writeState } from "./store.js";

function applySeed(seed: MockSeed): void {
  const state = readState();
  if (state.seeded) {
    return;
  }
  state.seeded = true;
  if (seed.signedIn) {
    state.signedIn = true;
  }
  writeState();
  for (const fake of allMockServices()) {
    fake.seed?.(seed);
  }
  writeState();
}

function reset(): void {
  disposeMockServices();
  clearState();
}

/**
 * Optional sample content for mock mode: start signed in or not, rows per
 * simple-db table, simple-group groups. It applies ONCE per origin — the
 * first call seeds, every later call (on later loads too) leaves the state
 * alone, so what the user has since changed is never overwritten. Call it
 * after importing the service packages it seeds. A no-op when mock mode is
 * off; never required.
 */
export function seedMock(seed: MockSeed): void {
  if (isMockMode()) {
    applySeed(seed);
  }
}

/**
 * Clears every fake's state and the mock identity (back to signed out), in
 * memory and in `localStorage`; a later `seedMock` applies again. A no-op
 * when mock mode is off.
 */
export function resetMock(): void {
  if (isMockMode()) {
    reset();
  }
}
