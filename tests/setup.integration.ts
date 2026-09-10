/**
 * Integration-project setup (phase B): a REAL DATABASE_URL is required — in
 * CI it points at a throwaway Neon branch created for the run, locally at a
 * branch you made with `neonctl branches create`.
 *
 * Two refusals, both deliberate:
 *   - no DATABASE_URL → these tests cannot run (they are not unit tests);
 *   - the PRODUCTION endpoint → never. The endpoint id is part of every Neon
 *     connection string, so this is a reliable tripwire, not a heuristic.
 */
const url = process.env.DATABASE_URL ?? "";
if (!url) {
  throw new Error("integration tests need DATABASE_URL (a Neon branch, never production)");
}
/** Endpoint of the `main` (production) branch of project fragrant-morning-71359670. */
const PRODUCTION_ENDPOINT = "ep-misty-bread-akwno7u7";
if (url.includes(PRODUCTION_ENDPOINT)) {
  throw new Error(
    "DATABASE_URL points at the PRODUCTION Neon branch — refusing to run integration tests. " +
      "Create a branch: neonctl branches create --name ci-local --parent main",
  );
}
process.env.BRIDGE_DRY_RUN = "1";
