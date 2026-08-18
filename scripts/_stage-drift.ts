import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { sql } from "drizzle-orm";
async function main() {
  const rows = await db.select({
    stage: sql<string>`COALESCE(${leads.pipelineStage}, 'NULL')`,
    active: leads.active,
    c: sql<number>`count(*)`,
  }).from(leads).groupBy(sql`COALESCE(${leads.pipelineStage}, 'NULL')`, leads.active).orderBy(sql`count(*) DESC`);
  console.log("DB pipeline_stage distribution (all leads):");
  console.log("stage".padEnd(24), "active".padEnd(8), "count");
  for (const r of rows) console.log(String(r.stage).padEnd(24), String(r.active).padEnd(8), r.c);

  console.log("\nActive-only totals per stage:");
  const act = await db.select({
    stage: sql<string>`COALESCE(${leads.pipelineStage}, 'NULL')`,
    c: sql<number>`count(*)`,
  }).from(leads).where(eq_active()).groupBy(sql`COALESCE(${leads.pipelineStage}, 'NULL')`).orderBy(sql`count(*) DESC`);
  for (const r of act) console.log(String(r.stage).padEnd(24), r.c);
}
function eq_active() { return sql`${leads.active} = true`; }
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
