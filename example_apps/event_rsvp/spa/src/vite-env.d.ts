/// <reference types="vite/client" />

// The platform auth runtime, loaded in index.html from
// `https://pilely.app/~/client.js` (SPA standard §0). It is served centrally so a
// fix to the sign-in dance reaches every neoApp without a rebuild — do not
// reimplement any of it locally.
declare global {
  interface PilelyClaims {
    /** the user's id — identity (handles are mutable, ids are not) */
    sub?: string;
    /** display handle, may be stale within the token's life */
    handle?: string;
    /** the app this token is scoped to */
    pile_id?: string;
    /** epoch SECONDS */
    exp?: number;
    /** the host this token may be used at */
    aud?: string;
  }

  interface PilelyClient {
    /** Resolves once a sign-in callback (if any) has been consumed. */
    ready: Promise<boolean>;
    /** True on an app host (`<label>.pilely.app` / custom domain), false on the apex. */
    isAppOrigin(): boolean;
    apexOrigin(): string;
    /**
     * Identity from the token's claims — no round trip. Null when signed
     * out — INCLUDING on a public app's anonymous token, which is what makes
     * `user() === null` the reliable "show the sign-in affordance" test
     * (denied writes come back as uniform 404s, never 401s).
     */
    user(): { id: string | null; handle: string | null; app: string | null } | null;
    claims(): PilelyClaims | null;
    token(): string | null;
    /** Data call carrying the token (cross-origin too); silently re-mints on 401. */
    fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
    /** The app id declared by `<meta name="pilely-app">`, if any. */
    appId(): string | null;
    /** Start the sign-in dance. Defaults to the declared app id. Navigates away. */
    signIn(appId?: string): Promise<void>;
    signOut(): void;
    takeReturnPath(): string | null;
  }

  interface Window {
    pilely?: PilelyClient;
  }
}

export {};
