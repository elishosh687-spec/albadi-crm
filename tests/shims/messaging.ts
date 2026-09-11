/**
 * Test-only stand-in for `@/lib/messaging`.
 *
 * The real adapter picks its backend with a CommonJS `require("../bridge/client")`
 * — fine under Next's bundler, unresolvable under vitest's ESM transform, so any
 * route that reaches `app/actions/v2.ts` cannot even be imported in a test.
 * Production has run on the bridge (USE_BRIDGE=1) since 2026-06; this shim is
 * that branch of the adapter, written as a plain import. Wired by an alias in
 * vitest.config.mts (integration project only).
 */
export * from "@/lib/bridge/client";
export { sendBridgeMessage as sendMessage } from "@/lib/bridge/client";
