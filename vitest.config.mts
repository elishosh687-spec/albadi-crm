/**
 * Test runner config. Two projects:
 *   unit        — pure modules, NO database. `@/lib/db` is replaced by a Proxy
 *                 that throws on any access (tests/setup.unit.ts), so a unit test
 *                 that reaches the DB by accident fails loudly instead of hanging.
 *   integration — runs against a real DATABASE_URL (a throwaway Neon branch in
 *                 CI). Empty until phase B; declared now so the CI job is stable.
 *
 * `studio/` (own node_modules, zod v4), `legacy/`, `scripts/` and `bot design/`
 * are excluded — they are not part of the app graph.
 * (.mts because package.json has no "type":"module".)
 */
import { defineConfig } from "vitest/config";

const EXCLUDE = [
  "**/node_modules/**",
  "studio/**",
  "legacy/**",
  "scripts/**",
  ".next/**",
  "bot design/**",
  "_stitch/**",
  "retool/**",
  "docs/**",
];

const ENV = {
  NODE_ENV: "test",
  LOG_LEVEL: "error", // the logger defaults to debug outside production
  TZ: "Asia/Jerusalem",
};

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: [
            "lib/**/*.test.ts",
            "app/**/*.test.ts",
            "integrations/**/*.test.ts",
            "tests/unit/**/*.test.ts",
          ],
          exclude: EXCLUDE,
          env: ENV,
          setupFiles: ["tests/setup.unit.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          exclude: EXCLUDE,
          env: { ...ENV },
          setupFiles: ["tests/setup.integration.ts"],
          passWithNoTests: true,
        },
      },
    ],
  },
});
