// The simple_limiter fake for mock mode: `POST /challenge` answers a
// challenge `solveChallenge()` solves like a real one, at the platform's
// difficulty, bound to the mock app. Its signature is not the platform's —
// nothing in mock mode checks it, because no fake checks a challenge.

import type { MockService, MockServiceContext } from "@pilely/core";

import { sha256Hex } from "./sha256.js";
import type { Challenge } from "./types.js";

/** A string unique to this fake, so a production bundle can be grepped for
 *  its absence. */
const MARKER = "pilely-mock-fake:simple-limiter";

/** The platform's difficulty, so a mock solve takes as long as a real one. */
export const MOCK_MAX_NUMBER = 100_000;
/** A challenge expires 5 minutes after it is handed out. */
const CHALLENGE_TTL_SECS = 300;

function randomHex(bytes: number): string {
  const buffer = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(buffer);
  } else {
    for (let i = 0; i < bytes; i += 1) {
      buffer[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(buffer, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function mockChallenge(appId: string, nowMs: number): Challenge {
  const expires = Math.floor(nowMs / 1000) + CHALLENGE_TTL_SECS;
  const salt = `${randomHex(12)}?expires=${expires}&app=${appId}&`;
  const number = Math.floor(Math.random() * (MOCK_MAX_NUMBER + 1));
  const challenge = sha256Hex(`${salt}${number}`);
  return {
    algorithm: "SHA-256",
    challenge,
    maxnumber: MOCK_MAX_NUMBER,
    salt,
    signature: sha256Hex(`mock-signature:${challenge}`),
  };
}

export function createSimpleLimiterFake(context: MockServiceContext): MockService {
  return {
    marker: MARKER,
    handle(request) {
      if (request.path === "/challenge") {
        return context.ok(mockChallenge(context.appId, context.now()));
      }
      return null;
    },
  };
}
