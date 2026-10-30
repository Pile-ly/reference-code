import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/* One self-contained dist/index.html: every stylesheet and script is
   inlined, so the build can be opened from file:// and shared as a file. */
export default defineConfig({
  plugins: [viteSingleFile()],
  build: {
    target: "es2020",
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    reportCompressedSize: false,
  },
});
