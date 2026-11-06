/**
 * True only when the app was built by Vite with `VITE_PILELY_MOCK` set to
 * exactly `"1"`. Unset, empty, `"true"`, `"0"` — anything else — is off.
 *
 * A build-time switch, nothing a page can flip: Vite replaces the literal
 * `import.meta.env.VITE_PILELY_MOCK` below with the value at build time
 * (and hands it to pre-bundled dependencies in the dev server), so in a
 * build without the variable this returns a constant `false` and every
 * `if (isMockMode())` branch — and everything only that branch reaches —
 * tree-shakes out. Keep the read literal and the guard a `typeof`: a
 * `try`/`catch` or an optional chain here stops the bundler folding it.
 *
 * Outside Vite `import.meta.env` does not exist, and the `typeof` guard
 * reads that as off. Mock mode is supported under Vite only.
 */
export function isMockMode(): boolean {
  return typeof import.meta.env !== "undefined" && import.meta.env.VITE_PILELY_MOCK === "1";
}
