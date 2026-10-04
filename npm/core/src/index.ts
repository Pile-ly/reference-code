// @pilely/core — the React provider and auth hooks over the platform's
// `client.js` runtime, plus the transport every service package shares.
// See README.md for the boundary this package is not allowed to cross.

export type { PilelyClaims, PilelyClient, PilelyService, PilelyUser } from "./types.js";
export { PilelyError } from "./error.js";
export { PilelyProvider, SignedIn, SignedOut, usePilelyAuth } from "./react/provider.js";
export type { PilelyAuth, PilelyProviderProps } from "./react/provider.js";
export { call, collectPages } from "./call.js";
export type { CallOptions } from "./call.js";
export { isMockMode } from "./mock/flag.js";
export { seedMock, resetMock } from "./mock/control.js";
export { registerMockService } from "./mock/registry.js";
export type {
  MockReply,
  MockRequest,
  MockSeed,
  MockSeedGroup,
  MockService,
  MockServiceContext,
  MockServiceFactory,
} from "./mock/registry.js";

// Shared by the @pilely service packages: runtime accessors and hook
// plumbing. Apps use PilelyProvider, usePilelyAuth and the service hooks.
export { ready, serviceOrigin, appId } from "./runtime.js";
export { assertPilelyRuntime } from "./assert.js";
export { useServiceContext } from "./react/context.js";
export type { PilelyContextValue } from "./react/context.js";
export {
  PILELY_QUERY_ROOT,
  serviceQueryKey,
  serviceRetry,
  useServiceInfiniteQuery,
  useServiceMutation,
  useServiceQuery,
} from "./react/service_hooks.js";
export type {
  ServiceInfiniteQueryOptions,
  ServiceMutationOptions,
  ServicePage,
  ServiceQueryOptions,
} from "./react/service_hooks.js";
