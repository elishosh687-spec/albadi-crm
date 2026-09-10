/**
 * Integration-project setup (phase B): a REAL DATABASE_URL is required — in
 * CI it points at a throwaway Neon branch created for the run.
 */
if (!process.env.DATABASE_URL) {
  throw new Error("integration tests need DATABASE_URL (a Neon branch, never production)");
}
