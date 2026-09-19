import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: process.env.VITE_BASE ?? "/reference-code/storefront/",
  build: { assetsDir: "_assets" },
  plugins: [react()],
  test: { environment: "node" },
});
