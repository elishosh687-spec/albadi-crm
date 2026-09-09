import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { inArray } from "drizzle-orm";
async function main() {
  const sids = ["34702446", "972507775685@s.whatsapp.net"]; // יוסי, יוסף אדרי
  const rows = await db.select({ sid: leads.manychatSubId, name: leads.name, stage: leads.pipelineStage, updated: leads.updatedAt, ghl: leads.ghlContactId })
    .from(leads).where(inArray(leads.manychatSubId, sids));
  for (const r of rows) console.log(`${r.name} | stage=${r.stage ?? "NULL"} | updated=${r.updated?.toISOString()} | sid=${r.sid}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
