import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/support/empty.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts", "templates/**/*.test.ts"],
    testTimeout: 30_000,
    // Each file migrates its own in-memory database in a hook; under full-suite load that takes longer than 30 s.
    hookTimeout: 120_000,
  },
});
