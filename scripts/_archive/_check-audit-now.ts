import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { sql } from "drizzle-orm";
import { runPipelineAudit } from "@/lib/analysis/pipeline-audit";
async function main() {
  const names = ["יוסי", "מור", "יוסף אמון", "יוסף אדרי"];
  console.log("=== current DB stage ===");
  for (const n of names) {
    const rows = await db.select({ name: leads.name, stage: leads.pipelineStage, sid: leads.manychatSubId })
      .from(leads).where(sql`${leads.name} LIKE ${'%' + n + '%'}`);
    for (const r of rows) console.log(`  ${r.name} → ${r.stage ?? "NULL"}  (sid ${r.sid?.slice(0,16)})`);
  }
  const a = await runPipelineAudit();
  console.log(`\n=== audit NOW: noTask=${a.noTask.length} stageLag=${a.stageLag.length} ===`);
  for (const r of a.stageLag) console.log(`  ${(r.name ?? "—").padEnd(20)} ${(r.currentStage ?? "NULL").padEnd(14)} → ${r.suggestedStage}  [${r.reason}]`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
