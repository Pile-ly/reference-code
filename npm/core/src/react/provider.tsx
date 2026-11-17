import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { client } from "../runtime.js";
import type { PilelyClient, PilelyUser } from "../types.js";
import { PilelyContext, useServiceContext } from "./context.js";
import type { PilelyContextValue } from "./context.js";
import { PILELY_QUERY_ROOT } from "./service_hooks.js";

export interface PilelyProviderProps {
  children?: ReactNode;
  /** An app that already owns a `QueryClient` passes it here; otherwise the
   *  provider creates its own. */
  queryClient?: QueryClient;
}

/** The runtime on `window.pilely` (the mock runtime in mock mode), or
 *  `null` when `client.js` is not loaded. */
function loadedRuntime(): PilelyClient | null {
  try {
    return client();
  } catch {
    return null;
  }
}

function sameUser(a: PilelyUser | null, b: PilelyUser | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.id === b.id && a.app === b.app;
}

interface AuthState {
  ready: boolean;
  loaded: boolean;
  user: PilelyUser | null;
}

/**
 * The one root provider: a React view of `window.pilely` plus the TanStack
 * `QueryClient` every `@pilely` hook caches in.
 *
 * It reads `ready`, `user()`, `signIn()` and `signOut()` off the runtime and
 * nothing else. `ready` turns `true` once `window.pilely.ready` settled;
 * signed in means `user() !== null`; after `signIn()` resolves (mock mode
 * signs in in place, the real runtime navigates away first) `user()` is
 * read again. An identity change clears every query under `["pilely"]` and
 * refetches the ones still on screen. With no runtime on `window.pilely`
 * the provider is `ready` and signed out at once.
 */
export function PilelyProvider({ children, queryClient }: PilelyProviderProps): ReactNode {
  const [ownClient] = useState(() => queryClient ?? new QueryClient());
  const cache = queryClient ?? ownClient;

  const [auth, setAuth] = useState<AuthState>({ ready: false, loaded: true, user: null });
  const userRef = useRef<PilelyUser | null>(null);
  const epochRef = useRef(0);

  useEffect(() => {
    let live = true;
    const runtime = loadedRuntime();
    if (!runtime) {
      userRef.current = null;
      setAuth({ ready: true, loaded: false, user: null });
      return;
    }
    const settle = (): void => {
      if (!live) {
        return;
      }
      const user = runtime.user();
      userRef.current = user;
      setAuth({ ready: true, loaded: true, user });
    };
    runtime.ready.then(settle, settle);
    return () => {
      live = false;
    };
  }, []);

  const applyIdentity = useCallback(
    (next: PilelyUser | null) => {
      const previous = userRef.current;
      userRef.current = next;
      setAuth((state) => ({ ...state, user: next }));
      if (sameUser(previous, next)) {
        return;
      }
      epochRef.current += 1;
      const root = { queryKey: [PILELY_QUERY_ROOT] };
      void cache.cancelQueries(root);
      cache.removeQueries({ ...root, type: "inactive" });
      void cache.resetQueries(root);
    },
    [cache],
  );

  const signIn = useCallback(
    async (target?: string) => {
      const runtime = client();
      await runtime.signIn(target);
      applyIdentity(runtime.user());
    },
    [applyIdentity],
  );

  const signOut = useCallback(() => {
    const runtime = loadedRuntime();
    if (!runtime) {
      return;
    }
    runtime.signOut();
    applyIdentity(runtime.user());
  }, [applyIdentity]);

  const value = useMemo<PilelyContextValue>(
    () => ({
      queryClient: cache,
      ready: auth.ready,
      loaded: auth.loaded,
      user: auth.user,
      signIn,
      signOut,
      epoch: () => epochRef.current,
      currentUser: () => userRef.current,
    }),
    [cache, auth, signIn, signOut],
  );

  return (
    <PilelyContext.Provider value={value}>
      <QueryClientProvider client={cache}>{children}</QueryClientProvider>
    </PilelyContext.Provider>
  );
}

export interface PilelyAuth {
  /** `false` until the runtime's boot settled. */
  ready: boolean;
  /** The signed-in user, or `null` when signed out (an anonymous visitor
   *  included). */
  user: PilelyUser | null;
  /** Starts sign-in. The real runtime navigates away; mock mode signs in in
   *  place and the provider then updates `user`. */
  signIn(target?: string): Promise<void>;
  /** Signs out and clears every cached `@pilely` query. */
  signOut(): void;
}

/** Auth state from `<PilelyProvider>`: `{ ready, user, signIn, signOut }`. */
export function usePilelyAuth(): PilelyAuth {
  const { ready, user, signIn, signOut } = useServiceContext("usePilelyAuth");
  return useMemo(() => ({ ready, user, signIn, signOut }), [ready, user, signIn, signOut]);
}

/** Renders its children once `ready`, and only when signed in. */
export function SignedIn({ children }: { children?: ReactNode }): ReactNode {
  const { ready, user } = useServiceContext("SignedIn");
  return ready && user !== null ? children : null;
}

/** Renders its children once `ready`, and only when signed out. */
export function SignedOut({ children }: { children?: ReactNode }): ReactNode {
  const { ready, user } = useServiceContext("SignedOut");
  return ready && user === null ? children : null;
}
