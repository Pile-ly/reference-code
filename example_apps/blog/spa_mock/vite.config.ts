import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: process.env.VITE_BASE ?? "/reference-code/blog/",
  plugins: [react()],
  test: { environment: "node" },
});
