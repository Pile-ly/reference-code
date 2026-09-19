// Who is looking at the page — rehydrated ONCE from the platform client's
// token claims when the SPA mounts (see the hook in router.tsx).
//
// Flow: window.pilely.ready (sign-in callback consumed, if any) →
// window.pilely.user() → this store → every component reads from here.
//
// The rule this store exists to teach — the PRIVATE-app inversion of the
// blog's lesson: no anonymous credential can exist on a private app, so
// `user() === null` simply means "render the sign-in gate". There is no
// owner-vs-visitor split beyond that: the server is the only real gate,
// and a signed-in NON-owner is indistinguishable from "this app doesn't
// exist" — their first list answers the uniform 404 (never a 401/403), so
// the UI never derives "you're not allowed" from a status code.

import { create } from "zustand";

export interface SessionUser {
  id: string;
  handle: string;
}

interface SessionState {
  /** False until the client's ready promise resolved and claims were read. */
  ready: boolean;
  /** Null = signed out (no anonymous token exists on a private app). */
  user: SessionUser | null;
  rehydrate: () => Promise<void>;
  /** Wired to every "Login with Pilely" affordance. Navigates away. */
  signIn: () => void;
  signOut: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  ready: false,
  user: null,

  rehydrate: async () => {
    const pilely = window.pilely;
    if (!pilely) {
      // client.js failed to load (offline dev, blocked script) — the app
      // still renders, just permanently signed-out.
      set({ ready: true, user: null });
      return;
    }
    await pilely.ready;
    const u = pilely.user();
    const user = u?.id && u.handle ? { id: u.id, handle: u.handle } : null;
    set({ ready: true, user });
  },

  signIn: () => {
    void window.pilely?.signIn();
  },

  signOut: () => {
    window.pilely?.signOut();
    set({ user: null });
  },
}));
