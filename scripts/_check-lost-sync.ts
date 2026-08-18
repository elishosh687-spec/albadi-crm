import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { sql } from "drizzle-orm";
async function main() {
  const names = ["איתן", "אמנון גמליאל", "ארן כהן", "אל גרבי", "אלי כהן"];
  for (const n of names) {
    const rows = await db.select({
      sid: leads.manychatSubId, name: leads.name, stage: leads.pipelineStage,
      loss: leads.lossReason, ghl: leads.ghlContactId, active: leads.active, updated: leads.updatedAt,
    }).from(leads).where(sql`${leads.name} LIKE ${'%' + n + '%'}`);
    if (!rows.length) { console.log(`(no match for "${n}")`); continue; }
    for (const r of rows) {
      console.log(`${r.name} | stage=${r.stage ?? "NULL"} | loss=${r.loss ?? "—"} | active=${r.active} | ghl=${r.ghl ? "yes" : "NO"} | updated=${r.updated?.toISOString()?.slice(0,10)}`);
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
