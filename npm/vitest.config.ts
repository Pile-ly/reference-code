import { defineConfig } from "vitest/config";

// Route and mock tests run under node. Hook tests are `*.test.tsx` and
// declare `// @vitest-environment jsdom` in their first line.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: ["*/src/**/*.test.ts", "*/src/**/*.test.tsx"],
  },
});
