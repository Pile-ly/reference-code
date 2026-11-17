// The one simple_limiter route an app's page calls: `POST /challenge`. The
// challenge-policy routes stay HTTP routes owners and their agents call
// directly (https://simple-limiter.pilely.app/README.md); no package wraps
// them.

import { call, isMockMode, registerMockService } from "@pilely/core";

import { createSimpleLimiterFake } from "./mock.js";
import type { Challenge } from "./types.js";

// Importing this package is all an app does to get its fake in mock mode.
// Dead code in a build without `VITE_PILELY_MOCK=1`, fake included.
if (isMockMode()) {
  registerMockService("simple-limiter", createSimpleLimiterFake);
}

/**
 * A fresh bot-check challenge for this app, from `POST
 * simple-limiter.pilely.app/challenge` with the page's token: a signed-in
 * user's, or the anonymous token `client.js` mints for a signed-out visitor.
 * It is bound to this app and expires 5 minutes after it is handed out.
 * Solve it with `solveChallenge()`. Throws `PilelyError` on a refusal
 * (`SimpleLimiterErrorCode`).
 */
export async function getChallenge(): Promise<Challenge> {
  const json = await call<Challenge>({ service: "simple-limiter", path: "/challenge" });
  return {
    algorithm: json.algorithm,
    challenge: json.challenge,
    maxnumber: json.maxnumber,
    salt: json.salt,
    signature: json.signature,
  };
}
