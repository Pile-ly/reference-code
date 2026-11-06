// The ALTCHA v1 solver: find the number whose SHA-256 of `salt + number`
// equals `challenge`, and encode the answer root reads from
// `X-Pilely-Challenge`. The payload is the one the platform's verifier
// (the `altcha-lib-rs` v1 format) decodes: standard base64 of the JSON
// `{algorithm, challenge, number, salt, signature}`, the four strings as
// issued.

import { PilelyError } from "@pilely/core";

import { badgeFinished, badgeStarted } from "./badge.js";
import { hexToWords, PrefixHasher } from "./sha256.js";
import type { Challenge } from "./types.js";

/** The one algorithm the platform issues. */
export const CHALLENGE_ALGORITHM = "SHA-256";

/** How long the search runs before it yields to the page, so the spinner
 *  and the page stay responsive on a slow phone. */
const SLICE_MS = 16;
/** Candidates tried between two clock reads. */
const CHECK_EVERY = 1_000;

function unsolvable(reason: string): PilelyError {
  return new PilelyError(0, "challenge_unsolvable", reason);
}

function yieldToPage(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function sameWords(a: Int32Array, b: Int32Array): boolean {
  for (let i = 0; i < 8; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/** The number from 0 to `challenge.maxnumber` that solves it. Throws
 *  `challenge_unsolvable` when the challenge is malformed or none does. */
export async function findNumber(challenge: Challenge): Promise<number> {
  if (challenge.algorithm !== CHALLENGE_ALGORITHM) {
    throw unsolvable(`unsupported challenge algorithm "${String(challenge.algorithm)}"`);
  }
  const target = typeof challenge.challenge === "string" ? hexToWords(challenge.challenge) : null;
  if (!target) {
    throw unsolvable("the challenge is not a SHA-256 hex digest");
  }
  if (typeof challenge.salt !== "string") {
    throw unsolvable("the challenge has no salt");
  }
  const max = challenge.maxnumber;
  if (!Number.isSafeInteger(max) || max < 0) {
    throw unsolvable("the challenge's maxnumber is not a whole number");
  }
  const hasher = new PrefixHasher(challenge.salt);
  let sliceStart = now();
  for (let number = 0; number <= max; number += 1) {
    if (sameWords(hasher.hashWords(String(number)), target)) {
      return number;
    }
    if (number % CHECK_EVERY === CHECK_EVERY - 1 && now() - sliceStart >= SLICE_MS) {
      await yieldToPage();
      sliceStart = now();
    }
  }
  throw unsolvable(`no number up to ${max} solves the challenge`);
}

/** The `X-Pilely-Challenge` value for `challenge` solved by `number`. */
export function encodeAnswer(challenge: Challenge, number: number): string {
  return btoa(
    JSON.stringify({
      algorithm: challenge.algorithm,
      challenge: challenge.challenge,
      number,
      salt: challenge.salt,
      signature: challenge.signature,
    }),
  );
}

/**
 * Solves `challenge` (from `getChallenge()`) in the page and answers the
 * string to send with the one call that needs it: `{ challenge: answer }`
 * on any `@pilely/*` call, which sends it as `X-Pilely-Challenge`. While it
 * solves, a badge in the bottom-right corner says "Verifying you're
 * human…", then "Verified ✓" for about a second and a half. One answer
 * works for one call, within 5 minutes of `getChallenge()`. Throws
 * `PilelyError` `challenge_unsolvable` (and removes the badge) when the
 * challenge cannot be solved. Runs in node and in a worker too, without the
 * badge.
 */
export async function solveChallenge(challenge: Challenge): Promise<string> {
  badgeStarted();
  let solved = false;
  try {
    const number = await findNumber(challenge);
    solved = true;
    return encodeAnswer(challenge, number);
  } finally {
    badgeFinished(solved);
  }
}
