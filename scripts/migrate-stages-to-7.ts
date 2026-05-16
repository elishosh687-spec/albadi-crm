/**
 * One-shot migration: reduce DB `leads.pipeline_stage` to the 7 canonical
 * values per docs/CUSTOMER-FLOW.md.
 *
 * Mapping:
 *   AWAITING_DECISION → AWAITING_ESTIMATE   (pure rename)
 *   QUOTED            → AWAITING_FINAL      (manual price was sent → same semantics)
 *   NEGOTIATING       → AWAITING_FINAL + pipeline_flag='NEEDS_ELI'
 *   WAITING_CALL      → WAITING_FACTORY + pipeline_flag='NEEDS_ELI'
 *                       + lead_tags row 'ביקש_שיחה' to preserve context
 *   IN_PROGRESS       → WAITING_FACTORY     (0 leads expected, included for safety)
 *
 * The script is idempotent — re-running after success is a no-op.
 *
 *   DRY RUN:  npx tsx scripts/migrate-stages-to-7.ts
 *   APPLY:    npx tsx scripts/migrate-stages-to-7.ts --apply
 */
import "dotenv/config";
import { db } from "../lib/db";
import { leads, leadTags } from "../drizzle/schema";
import { sql, eq, and } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

async function countBy(stage: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(eq(leads.pipelineStage, stage));
  return row?.n ?? 0;
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (writes)" : "DRY RUN (counts only)"}`);
  console.log("");

  const before: Record<string, number> = {};
  for (const s of [
    "AWAITING_DECISION",
    "QUOTED",
    "NEGOTIATING",
    "WAITING_CALL",
    "IN_PROGRESS",
  ]) {
    before[s] = await countBy(s);
  }
  console.log("Before:", before);

  if (!APPLY) {
    console.log("");
    console.log("Would run (dry run):");
    console.log(`  UPDATE leads SET pipeline_stage='AWAITING_ESTIMATE' WHERE pipeline_stage='AWAITING_DECISION'`);
    console.log(`  UPDATE leads SET pipeline_stage='AWAITING_FINAL' WHERE pipeline_stage='QUOTED'`);
    console.log(`  UPDATE leads SET pipeline_stage='AWAITING_FINAL', pipeline_flag='NEEDS_ELI' WHERE pipeline_stage='NEGOTIATING'`);
    console.log(`  UPDATE leads SET pipeline_stage='WAITING_FACTORY', pipeline_flag='NEEDS_ELI' WHERE pipeline_stage='WAITING_CALL'`);
    console.log(`  INSERT lead_tags (manychat_sub_id, tag) for each WAITING_CALL lead, tag='ביקש_שיחה' ON CONFLICT DO NOTHING`);
    console.log(`  UPDATE leads SET pipeline_stage='WAITING_FACTORY' WHERE pipeline_stage='IN_PROGRESS'`);
    return;
  }

  // 1. Pure rename.
  await db
    .update(leads)
    .set({ pipelineStage: "AWAITING_ESTIMATE", updatedAt: new Date() })
    .where(eq(leads.pipelineStage, "AWAITING_DECISION"));

  // 2. QUOTED → AWAITING_FINAL.
  await db
    .update(leads)
    .set({ pipelineStage: "AWAITING_FINAL", updatedAt: new Date() })
    .where(eq(leads.pipelineStage, "QUOTED"));

  // 3. NEGOTIATING → AWAITING_FINAL + NEEDS_ELI.
  await db
    .update(leads)
    .set({
      pipelineStage: "AWAITING_FINAL",
      pipelineFlag: "NEEDS_ELI",
      updatedAt: new Date(),
    })
    .where(eq(leads.pipelineStage, "NEGOTIATING"));

  // 4. WAITING_CALL → WAITING_FACTORY + NEEDS_ELI + 'ביקש_שיחה' tag.
  // Capture sids before the stage update so the tag insert sees the right rows.
  const wcRows = await db
    .select({ sid: leads.manychatSubId })
    .from(leads)
    .where(eq(leads.pipelineStage, "WAITING_CALL"));
  await db
    .update(leads)
    .set({
      pipelineStage: "WAITING_FACTORY",
      pipelineFlag: "NEEDS_ELI",
      updatedAt: new Date(),
    })
    .where(eq(leads.pipelineStage, "WAITING_CALL"));
  for (const r of wcRows) {
    try {
      await db
        .insert(leadTags)
        .values({ manychatSubId: r.sid, tag: "ביקש_שיחה" })
        .onConflictDoNothing();
    } catch (e) {
      console.warn(`tag insert failed for ${r.sid}:`, (e as Error).message);
    }
  }

  // 5. IN_PROGRESS → WAITING_FACTORY (safety; should be 0 rows).
  await db
    .update(leads)
    .set({ pipelineStage: "WAITING_FACTORY", updatedAt: new Date() })
    .where(eq(leads.pipelineStage, "IN_PROGRESS"));

  console.log("");
  console.log("Applied.");

  // Audit after.
  const after: Record<string, number> = {};
  for (const s of [
    "AWAITING_DECISION",
    "QUOTED",
    "NEGOTIATING",
    "WAITING_CALL",
    "IN_PROGRESS",
  ]) {
    after[s] = await countBy(s);
  }
  console.log("After (should be all 0):", after);

  const newCounts: Record<string, number> = {};
  for (const s of ["NEW", "AWAITING_ESTIMATE", "AWAITING_LOGO", "WAITING_FACTORY", "AWAITING_FINAL", "WON", "DROPPED"]) {
    newCounts[s] = await countBy(s);
  }
  console.log("Canonical 7 stages:", newCounts);
}

main().catch((e) => {
  console.error("Migration failed:", e);
  process.exit(1);
});
