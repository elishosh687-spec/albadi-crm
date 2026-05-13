/**
 * Inject a synthetic pending draft so the Retool supervisor console has
 * something to render before a real money-moment escalation fires.
 *
 * Usage:
 *   npx tsx scripts/seed-draft.ts                            # uses TEST_JID + canned text
 *   npx tsx scripts/seed-draft.ts <sub_id> "<draft text>"    # custom lead + text
 *
 * Notes:
 *   - The sub_id must already exist in `leads` (auto-registered on first
 *     inbound), otherwise the FK-like trim() match on the API endpoints
 *     will not find a lead row to enrich.
 *   - Each run inserts a new row. Status starts 'pending'. Clean up with
 *     scripts/clear-drafts.ts (not bundled) or a manual DELETE.
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { botDrafts, leads } from "@/drizzle/schema";
import { sql } from "drizzle-orm";

const DEFAULT_JID = "133144455962747@lid"; // Eli's test JID
const DEFAULT_TEXT = "טסט: שלום, רציתי להציע 10% הנחה נוספת — אבדוק ואחזור.";

const [, , argSid, argText] = process.argv;
const sid = (argSid ?? DEFAULT_JID).trim();
const text = (argText ?? DEFAULT_TEXT).trim();

(async () => {
  const [lead] = await db
    .select({ sid: leads.manychatSubId, name: leads.name, stage: leads.pipelineStage })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${sid}`)
    .limit(1);

  if (!lead) {
    console.error(`[seed-draft] no lead found for ${sid}. Send an inbound first to auto-register.`);
    process.exit(1);
  }

  const [draft] = await db
    .insert(botDrafts)
    .values({
      manychatSubId: sid,
      draftText: text,
      status: "pending",
      moneyReason: "manual",
      pipelineStageAtGen: lead.stage,
    })
    .returning();

  console.log(`[seed-draft] inserted draft id=${draft.id} for ${lead.name ?? sid} (stage=${lead.stage})`);
  console.log(`[seed-draft] text: ${text}`);
  process.exit(0);
})().catch((e) => {
  console.error("[seed-draft] failed", e);
  process.exit(1);
});
