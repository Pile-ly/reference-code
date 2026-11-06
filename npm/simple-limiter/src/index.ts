// @pilely/simple-limiter — the pilely.app bot check in the browser: get a
// challenge, solve it, and send the answer with the one call a challenge
// policy guards, as `{ challenge }` on any @pilely call.

export { getChallenge } from "./api.js";
export { solveChallenge } from "./solve.js";
export type { Challenge, SimpleLimiterErrorCode } from "./types.js";
