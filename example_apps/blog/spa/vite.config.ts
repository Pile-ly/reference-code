// Vite config per the Pilely SPA standard (pilely.app/skill/standards/spa).
//
// The two settings that are NOT free to change:
//  - `base: "/"` — every neoApp owns the root of its own origin
//    (`<label>.pilely.app/`). Any other base is rejected at upload
//    (`bundle_base_not_root`).
//  - `build.assetsDir: "_assets"` — every directory at the bundle root
//    must start with `_` so it can never collide with a nested neoApp's
//    path segment (`bundle_root_folder_invalid` otherwise).
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
// vitest/config re-exports Vite's defineConfig with the `test` field typed.
import { defineConfig } from "vitest/config";

// The two platform tags in index.html. Mock mode drops both, so a mock page
// never asks the apex for anything — sign-in included.
const PILELY_APP_META = /[ \t]*<meta name="pilely-app"[^>]*>\r?\n?/;
const CLIENT_JS_SCRIPT = /[ \t]*<script src="[^"]*\/~\/client\.js"><\/script>\r?\n?/;

// In mock mode, removes both tags from the served page. index.html itself
// keeps them, so the conformance test still reads them there.
function dropPlatformTagsInMock(mock: boolean) {
  return {
    name: "drop-platform-tags-in-mock",
    transformIndexHtml(html: string) {
      return mock ? html.replace(PILELY_APP_META, "").replace(CLIENT_JS_SCRIPT, "") : html;
    },
  };
}

export default defineConfig(({ mode }) => {
  // Mock mode: every @pilely package answers from in-memory fakes, with no
  // backend, no app id and no sign-in round trip (see README.md). Read
  // through loadEnv with the VITE_ prefix — .env files for this mode plus
  // VITE_* shell variables — the same values the browser code sees in
  // import.meta.env, so the config and the packages always agree.
  const mock = loadEnv(mode, process.cwd(), "VITE_").VITE_PILELY_MOCK === "1";

  return {
    base: "/",
    build: { assetsDir: "_assets" },
    plugins: [react(), dropPlatformTagsInMock(mock)],
    server: { port: 5173 },
    // Vitest: the tests here are string/logic-level (index.html conformance,
    // pure helpers) — no DOM environment needed.
    test: { environment: "node" },
  };
});
