import { createContext, useContext } from "react";
import type { QueryClient } from "@tanstack/react-query";

import type { PilelyUser } from "../types.js";

/** What `<PilelyProvider>` hands every hook below it. */
export interface PilelyContextValue {
  /** The one cache every `@pilely` hook reads and writes. */
  readonly queryClient: QueryClient;
  /** `false` until `window.pilely.ready` settled (or the runtime turned out
   *  to be absent). No data hook fires before this is `true`. */
  readonly ready: boolean;
  /** `false` when no runtime was found on `window.pilely`. */
  readonly loaded: boolean;
  readonly user: PilelyUser | null;
  signIn(target?: string): Promise<void>;
  signOut(): void;
  /** The identity epoch: it moves on every identity change, at the moment
   *  the provider clears the cache. A write that started under an older
   *  epoch never writes into the cache again. */
  epoch(): number;
  /** The identity right now — the same value as `user`, but current inside
   *  callbacks that outlive a render. */
  currentUser(): PilelyUser | null;
}

export const PilelyContext = createContext<PilelyContextValue | null>(null);

/**
 * The provider's context, or a thrown error naming `hookName` when the
 * calling component is not inside `<PilelyProvider>`. Every `@pilely` hook
 * starts here.
 */
export function useServiceContext(hookName: string): PilelyContextValue {
  const context = useContext(PilelyContext);
  if (!context) {
    throw new Error(`${hookName} must be used inside <PilelyProvider>; render <PilelyProvider> at the app root`);
  }
  return context;
}
