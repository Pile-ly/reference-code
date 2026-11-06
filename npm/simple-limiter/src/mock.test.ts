import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock mode is a build-time switch read when modules load, so it is set
// before any import below is evaluated.
vi.hoisted(() => {
  vi.stubEnv("VITE_PILELY_MOCK", "1");
});

import { resetMock } from "@pilely/core";

import { getChallenge, solveChallenge } from "./index.js";
import { MOCK_MAX_NUMBER } from "./mock.js";

let globalFetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  (globalThis as { window?: unknown }).window = {};
  globalFetchSpy = vi.fn();
  (globalThis as { fetch?: unknown }).fetch = globalFetchSpy;
  resetMock();
});

afterEach(() => {
  expect(globalFetchSpy).not.toHaveBeenCalled();
  resetMock();
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { fetch?: unknown }).fetch;
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("simple-limiter fake", () => {
  it("getChallenge answers a solvable challenge bound to the mock app, expiring in 5 minutes, signed out too", async () => {
    const before = Math.floor(Date.now() / 1000);
    const challenge = await getChallenge();
    expect(challenge).toMatchObject({ algorithm: "SHA-256", maxnumber: MOCK_MAX_NUMBER });
    expect(challenge.challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.signature).toMatch(/^[0-9a-f]{64}$/);
    const match = /^[0-9a-f]{24}\?expires=(\d+)&app=mock-app&$/.exec(challenge.salt);
    expect(match).not.toBeNull();
    const expires = Number(match?.[1]);
    expect(expires).toBeGreaterThanOrEqual(before + 300);
    expect(expires).toBeLessThanOrEqual(before + 301);

    const answer = await solveChallenge(challenge);
    const payload = JSON.parse(atob(answer)) as { number: number; salt: string };
    expect(payload.salt).toBe(challenge.salt);
    expect(payload.number).toBeGreaterThanOrEqual(0);
    expect(payload.number).toBeLessThanOrEqual(MOCK_MAX_NUMBER);
  });

  it("hands out a new puzzle every time", async () => {
    const [a, b] = await Promise.all([getChallenge(), getChallenge()]);
    expect(a.salt).not.toBe(b.salt);
  });
});
