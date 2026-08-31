/**
 * Development-only sanity check — never a module side effect (this package
 * declares `"sideEffects": false`, so merely importing it must do nothing).
 * Call it explicitly, e.g. behind `if (import.meta.env.DEV)`.
 *
 * Verifies (a) `window.pilely` is present, and (b) the `<meta
 * name="pilely-app">` tag sits ABOVE the `client.js` script tag in the
 * document. The ordering is a real footgun and silent when wrong:
 * `client.js` runs the boot-time anonymous mint synchronously while
 * parsing and reads the meta tag to know which app to mint for. Reversed,
 * a public app's signed-out visitors get no anonymous credential, every
 * read 401s, and the first data call bounces them to login.
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
    throw new Error('assertPilelyRuntime: <meta name="pilely-app"> is missing from the document');
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
        "client.js reads the meta at parse time to know which app to mint an anonymous token for",
    );
  }
}
