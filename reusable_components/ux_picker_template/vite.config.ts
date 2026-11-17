import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { viteSingleFile } from "vite-plugin-singlefile";

// `base: "./"` plus viteSingleFile means `npm run build` emits ONE
// self-contained dist/index.html with the CSS and JS inlined — a file the
// user can be handed and open by double-clicking, with no server.
export default defineConfig({
  base: "./",
  plugins: [react(), viteSingleFile()],
  test: { environment: "jsdom" },
});
