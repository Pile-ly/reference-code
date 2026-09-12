/**
 * Development-only sanity check — never a module side effect (this package
 * declares `"sideEffects": false`, so merely importing it must do nothing).
 * Call it explicitly, e.g. behind `if (import.meta.env.DEV)`.
 *
 * Verifies (a) `window.pilely` is present, and (b), ONLY when a `<meta
 * name="pilely-app">` tag is present at all, that it sits ABOVE the
 * `client.js` script tag in the document.
 *
 * The meta tag is OPTIONAL: `client.js` targets `location.host` on an app
 * origin and falls back to the tag only off one (local dev), so a document
 * with no tag at all is not a footgun and must not fail this check. The
 * ordering constraint still matters when the tag IS present, because
 * `client.js` reads it synchronously while parsing when it exists (the
 * local-dev fallback, and `appId()`'s fastest source) — reversed, that read
 * finds nothing and silently falls through to the origin-based/settled-token
 * paths instead.
 *
 * Known gap, not fixed here: the platform's own SPA standard shows this
 * meta tag AFTER the `client.js` script block and never states the
 * ordering constraint in writing. This assertion is the only enforcement
 * of a rule that today lives solely in the example apps' HTML comments.
 */
export function assertPilelyRuntime(): void {
  if (typeof window === "undefined" || !window.pilely) {
    throw new Error("assertPilelyRuntime: window.pilely is not present — is client.js loaded?");
  }
  if (typeof document === "undefined") {
    throw new Error("assertPilelyRuntime: no document to inspect");
  }

  const meta = document.querySelector('meta[name="pilely-app"]');
  if (!meta) {
    // Optional — nothing left to check.
    return;
  }

  const script = document.querySelector('script[src*="/~/client.js"]');
  if (!script) {
    throw new Error("assertPilelyRuntime: no <script> tag pointing at /~/client.js was found");
  }

  // DOCUMENT_POSITION_FOLLOWING (4): set on the argument's result when the
  // argument follows `meta` in the document. We need the script to follow
  // the meta tag, i.e. meta must come first.
  const position = meta.compareDocumentPosition(script);
  const scriptFollowsMeta = (position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  if (!scriptFollowsMeta) {
    throw new Error(
      'assertPilelyRuntime: <meta name="pilely-app"> must sit ABOVE the client.js script tag — ' +
        "client.js reads the meta at parse time when it is present",
    );
  }
}
