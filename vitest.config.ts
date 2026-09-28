import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": path.resolve("src/shared"),
      "@domain": path.resolve("src/domain"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/integration/**/*.test.ts"],
    // Denial-matrix and populated-upgrade integration tests exceed Vitest's
    // 5s default under CI/machine load; keep headroom without hiding hangs.
    testTimeout: 20_000,
  },
});
