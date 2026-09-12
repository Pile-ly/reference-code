// Who is looking at the page — rehydrated ONCE from the platform client's
// token claims when the SPA mounts (see the hook in router.tsx).
//
// Flow: window.pilely.ready (sign-in callback consumed, if any) →
// window.pilely.user() → this store → every component reads from here.
//
// The rule this store exists to teach: on a PUBLIC app, gate sign-in UI on
// `user() === null`, NEVER on a 401. The runtime quietly holds an anonymous
// token for signed-out visitors, so a denied write comes back as the
// uniform 404, not a 401 — status codes tell you nothing about "is this
// visitor signed in".

import { create } from "zustand";
import { OWNER_HANDLE } from "../config";

export interface SessionUser {
  id: string;
  handle: string;
}

interface SessionState {
  /** False until the client's ready promise resolved and claims were read. */
  ready: boolean;
  /** Null = signed out (including a public app's anonymous token). */
  user: SessionUser | null;
  /** Is the signed-in visitor the storefront owner? UI gating only —
   *  simple_db enforces the real permission regardless of what this says
   *  (the inquiries read group is empty: owner-only by construction). */
  isOwner: boolean;
  rehydrate: () => Promise<void>;
  /** Wired to every "Login with Pilely" affordance. Navigates away. */
  signIn: () => void;
  signOut: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  ready: false,
  user: null,
  isOwner: false,

  rehydrate: async () => {
    const pilely = window.pilely;
    if (!pilely) {
      // client.js failed to load (offline dev, blocked script) — the app
      // still renders, just permanently signed-out.
      set({ ready: true, user: null, isOwner: false });
      return;
    }
    await pilely.ready;
    const u = pilely.user();
    const user = u?.id && u.handle ? { id: u.id, handle: u.handle } : null;
    set({ ready: true, user, isOwner: user?.handle === OWNER_HANDLE });
  },

  signIn: () => {
    void window.pilely?.signIn();
  },

  signOut: () => {
    window.pilely?.signOut();
    set({ user: null, isOwner: false });
  },
}));
