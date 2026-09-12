// Just enough of the platform auth runtime for this component to typecheck
// on its own. The runtime is loaded in index.html from
// `https://pilely.app/~/client.js` (SPA standard §0) — served centrally so a
// fix to the sign-in dance reaches every neoApp without a rebuild. Never
// reimplement any of it locally.
//
// A real app declares the full surface (`fetch`, `claims`, `token`, …) once
// in its own `vite-env.d.ts`; every reference app here carries that version.
// If you drop this component into such an app, delete this file — the app's
// declaration already covers it.

declare global {
  interface PilelyClient {
    /** Resolves once a sign-in callback (if any) has been consumed. */
    ready: Promise<boolean>;
    /**
     * Identity from the token's claims — no round trip. Null when signed out,
     * INCLUDING on a public app's anonymous token, which is what makes
     * `user() === null` the reliable "show the sign-in affordance" test.
     */
    user(): { id: string | null; handle: string | null; app: string | null } | null;
    /** Start the sign-in dance. Defaults to the declared app id. Navigates away. */
    signIn(appId?: string): Promise<void>;
    signOut(): void;
  }

  interface Window {
    pilely?: PilelyClient;
  }
}

export {};
