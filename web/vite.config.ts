import { defineConfig } from "vitest/config";
export default defineConfig({
  server: { fs: { allow: [".."] }, proxy: { "/api": "http://localhost:8787" } },
  test: { environment: "jsdom", include: ["../tests/web/**/*.test.ts", "../tests/shared/**/*.test.ts"] },
});
