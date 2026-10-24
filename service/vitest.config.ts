import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { vitest: new URL("./node_modules/vitest/dist/index.js", import.meta.url).pathname } },
  test: {
    include: ["../tests/service/**/*.test.ts", "../tests/shared/**/*.test.ts"],
  },
});
