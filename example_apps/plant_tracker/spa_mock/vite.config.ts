// Vite config per the Pilely SPA standard (pilely.app/skill/standards/spa).
//
// The two settings that are NOT free to change:
//  - `base: "/reference-code/plant-tracker/"` — this API-free public mock
//    is served directly from the public R2 reference-code prefix, not as a
//    registered neoApp bundle.
//  - `build.assetsDir: "_assets"` — every directory at the bundle root
//    must start with `_` so it can never collide with a nested neoApp's
//    path segment (`bundle_root_folder_invalid` otherwise).
import react from "@vitejs/plugin-react";
// vitest/config re-exports Vite's defineConfig with the `test` field typed.
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: process.env.VITE_BASE ?? "/reference-code/plant-tracker/",
  build: { assetsDir: "_assets" },
  plugins: [react()],
  server: { port: 5173 },
  // Vitest: the tests here are string/logic-level (index.html conformance,
  // pure helpers) — no DOM environment needed.
  test: { environment: "node" },
});
