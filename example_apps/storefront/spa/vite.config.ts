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
// vitest/config re-exports Vite's defineConfig with the `test` field typed.
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/",
  build: { assetsDir: "_assets" },
  plugins: [react()],
  server: { port: 5173 },
  // Vitest: the tests here are string/logic-level (index.html conformance,
  // pure helpers) — no DOM environment needed.
  test: { environment: "node" },
});
