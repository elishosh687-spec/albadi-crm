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
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));

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
        resolve: {
          alias: [
            // The messaging adapter `require()`s its backend — see tests/shims/messaging.ts.
            { find: /^@\/lib\/messaging$/, replacement: `${here}tests/shims/messaging.ts` },
          ],
        },
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          exclude: EXCLUDE,
          // DATABASE_URL comes from the shell (a throwaway Neon branch — the
          // setup file refuses the production endpoint). Everything that could
          // reach a customer is neutralised: BRIDGE_DRY_RUN short-circuits every
          // WhatsApp send, and no GreenAPI / GHL / OpenAI credential is set, so
          // a path that slips past a mock fails loudly instead of sending.
          env: {
            ...ENV,
            BRIDGE_DRY_RUN: "1",
            GREEN_WEBHOOK_TOKEN: "ci-green-token",
            BOT_SECRET: "ci-bot-secret",
            CRON_SECRET: "ci-cron-secret",
            CALL_TRIGGER_SECRET: "ci-call-secret",
            GHL_WIDGET_TOKEN: "ci-widget-token",
            WIDGET_SALES_TOKEN: "ci-sales-token",
            ADMIN_PASSWORD: "ci-admin-password",
            SUPERVISOR_BYPASS: "1", // followups supervisor: approve the template, no LLM
            // Custom-gate secrets, so "no credential → 401" is a real check and
            // not the accidental result of an unset variable.
            GHL_INBOUND_SECRET: "ci-ghl-inbound",
            GHL_OUTBOUND_SECRET: "ci-ghl-outbound",
            FB_IMPORT_SECRET: "ci-fb-import",
            WEBSITE_IMPORT_SECRET: "ci-website-import",
            BRIDGE_WEBHOOK_SECRET: "ci-bridge-webhook",
            GHL_WEBHOOK_ENFORCE: "1",
            // Dead ManyChat path, but lib/manychat/config.ts still throws at import
            // without it and app/actions/v2.ts drags it in — set in prod, so set here.
            MANYCHAT_TOKEN: "ci-manychat-legacy",
            USE_BRIDGE: "1", // permanent in prod; without it the adapter requires the dead ManyChat client
          },
          setupFiles: ["tests/setup.integration.ts"],
          // Tests share one database and a few rows (app_config) — run files
          // one at a time, and give network round-trips room.
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 60_000,
          passWithNoTests: true,
        },
      },
    ],
  },
});
