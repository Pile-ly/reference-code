// The `window.pilely` runtime declaration — the payload of this package.
// This is a typed description of the auth runtime loaded from
// `https://<apex>/~/client.js` (SPA standard §0). It is served centrally so
// a fix to the sign-in dance reaches every neoApp without a rebuild; the
// declaration below never reimplements any of it, it only types it.

/** Claims carried by the current token, read locally — no round trip. */
export interface PilelyClaims {
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

/** Identity derived from the current token's claims. */
export interface PilelyUser {
  id: string | null;
  handle: string | null;
  app: string | null;
}

/**
 * The runtime object `client.js` assigns to `window.pilely`. Null when
 * signed out — INCLUDING on a public app's anonymous token, which is what
 * makes `user() === null` the reliable sign-in test on either an app that
 * mints anonymous tokens or a private app that never does (denied reads and
 * writes come back as uniform 404s on both, never 401s — never gate UI on a
 * status).
 */
export interface PilelyClient {
  /** Resolves once a sign-in callback (if any) has been consumed. */
  ready: Promise<boolean>;
  /** True on an app host (`<label>.pilely.app` / custom domain), false on the apex. */
  isAppOrigin(): boolean;
  apexOrigin(): string;
  user(): PilelyUser | null;
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

declare global {
  interface Window {
    pilely?: PilelyClient;
  }
}

/** The four managed services this scope has typed clients for. */
export type PilelyService = "simple-db" | "simple-blob" | "simple-group" | "simple-email";
