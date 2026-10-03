import { defineConfig } from "vitest/config";

// The extension's unit tests, card reader included. The Node scripts' own tests (scripts/*.test.mjs) use node:test and run
// through `npm run test:scripts`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
