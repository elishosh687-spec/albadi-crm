/**
 * One-off: dump escalations 1-32 with their full decision context as JSON.
 * Used to re-analyze them with proper Claude reasoning instead of templated.
 */
import "dotenv/config";
import { db } from "../lib/db";
import { escalations, decisions } from "../drizzle/schema";
import { eq, lte, gte, and } from "drizzle-orm";

async function main() {
  const rows = await db
    .select({
      id: escalations.id,
      manychatSubId: escalations.manychatSubId,
      leadName: escalations.leadName,
      reason: escalations.reason,
      triggerText: escalations.triggerText,
      inputMessages: decisions.inputMessages,
    })
    .from(escalations)
    .leftJoin(decisions, eq(escalations.decisionId, decisions.id))
    .where(and(gte(escalations.id, 1), lte(escalations.id, 32)));

  console.log(JSON.stringify(rows, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
