// @pilely/core — a typed facade over the platform's `client.js` runtime.
// See README.md for the boundary this package is not allowed to cross.

export type { PilelyClaims, PilelyClient, PilelyService, PilelyUser } from "./types.js";
export { PilelyError } from "./error.js";
export { ready, serviceOrigin, appId } from "./runtime.js";
export { call, collectPages } from "./call.js";
export type { CallOptions } from "./call.js";
export { assertPilelyRuntime } from "./assert.js";
