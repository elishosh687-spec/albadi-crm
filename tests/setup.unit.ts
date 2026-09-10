/**
 * Unit-project setup: no database, ever.
 *
 * `lib/db.ts` throws at import time without DATABASE_URL, and a dozen pure
 * modules (estimator, setter validator, website-origin, lead-gaps…) sit behind
 * files that import it at the top level. Replacing the module with a Proxy
 * lets those modules load, and makes any ACTUAL query fail with a clear
 * message instead of an HTTP timeout against a dummy URL.
 */
import { vi } from "vitest";

vi.mock("@/lib/db", () => {
  const trap = () => {
    throw new Error(
      "DB touched in a unit test — this module belongs in tests/integration, or mock the caller"
    );
  };
  const db = new Proxy({}, { get: trap, apply: trap });
  return { db };
});
