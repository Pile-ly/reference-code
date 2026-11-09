// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BADGE_ID, BADGE_STYLE_ID, badgeFinished, badgeStarted, FADE_MS, VERIFIED_MS } from "./badge.js";
import { solveChallenge } from "./index.js";
import type { Challenge } from "./index.js";
import { sha256Hex } from "./sha256.js";

function challengeFor(number: number, maxnumber = 2_000): Challenge {
  const salt = `${number.toString(16)}0123456789abcdef?expires=1700000300&app=app-1&`;
  const challenge = sha256Hex(`${salt}${number}`);
  return { algorithm: "SHA-256", challenge, maxnumber, salt, signature: "sig" };
}

function badge(): HTMLElement | null {
  return document.getElementById(BADGE_ID);
}

function badgeText(): string | null {
  return badge()?.querySelector(".pilely-challenge-label")?.textContent ?? null;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

describe("the corner badge", () => {
  it("says Verifying you're human… with a spinner while solving, then Verified ✓, then fades and is removed", async () => {
    const seen: (string | null)[] = [];
    const solving = solveChallenge(challengeFor(1_500));
    seen.push(badgeText());
    expect(badge()?.getAttribute("data-state")).toBe("verifying");
    expect(badge()?.querySelector(".pilely-challenge-spinner")).not.toBeNull();
    expect(badge()?.getAttribute("role")).toBe("status");

    await solving;
    seen.push(badgeText());
    expect(badge()?.getAttribute("data-state")).toBe("verified");

    vi.advanceTimersByTime(VERIFIED_MS - 1);
    expect(badge()?.getAttribute("data-state")).toBe("verified");
    vi.advanceTimersByTime(1);
    expect(badge()?.getAttribute("data-state")).toBe("fading");
    vi.advanceTimersByTime(FADE_MS);
    expect(badge()).toBeNull();

    expect(seen).toEqual(["Verifying you're human…", "Verified ✓"]);
  });

  it("sits in the bottom-right corner and injects its styles once", async () => {
    await solveChallenge(challengeFor(3));
    await solveChallenge(challengeFor(4));
    expect(document.querySelectorAll(`#${BADGE_STYLE_ID}`)).toHaveLength(1);
    const css = document.getElementById(BADGE_STYLE_ID)?.textContent ?? "";
    expect(css).toMatch(/position: fixed; right: 16px; bottom: 16px/);
    expect(document.querySelectorAll(`#${BADGE_ID}`)).toHaveLength(1);
  });

  it("is removed at once when the solve fails", async () => {
    const failing = solveChallenge(challengeFor(2_001, 2_000));
    expect(badgeText()).toBe("Verifying you're human…");
    await expect(failing).rejects.toMatchObject({ code: "challenge_unsolvable" });
    expect(badge()).toBeNull();
  });

  it("a new solve during the Verified ✓ pause shows Verifying again and is not cut short", async () => {
    await solveChallenge(challengeFor(5));
    vi.advanceTimersByTime(VERIFIED_MS - 100);
    const again = solveChallenge(challengeFor(6));
    expect(badgeText()).toBe("Verifying you're human…");
    vi.advanceTimersByTime(200);
    expect(badge()?.getAttribute("data-state")).toBe("verifying");
    await again;
    expect(badgeText()).toBe("Verified ✓");
  });

  it("overlapping solves share one badge, Verified ✓ only once the last finishes", () => {
    badgeStarted();
    badgeStarted();
    expect(document.querySelectorAll(`#${BADGE_ID}`)).toHaveLength(1);
    badgeFinished(true);
    expect(badgeText()).toBe("Verifying you're human…");
    badgeFinished(true);
    expect(badgeText()).toBe("Verified ✓");
  });
});
