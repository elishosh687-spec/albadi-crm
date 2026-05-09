/**
 * One-off: reset analyses for escalations 1-32 (the generic batch).
 * After running, /api/bot/pending-analyses will return them again for fresh analysis.
 */
import "dotenv/config";
import { db } from "../lib/db";
import { escalations } from "../drizzle/schema";
import { and, gte, lte } from "drizzle-orm";

async function main() {
  const result = await db
    .update(escalations)
    .set({
      analyzedAt: null,
      analysisSummary: null,
      suggestedReply: null,
      suggestedReplies: null,
      analyzeRequested: true,
    })
    .where(and(gte(escalations.id, 1), lte(escalations.id, 32)))
    .returning({ id: escalations.id });

  console.log(`reset ${result.length} escalations`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
