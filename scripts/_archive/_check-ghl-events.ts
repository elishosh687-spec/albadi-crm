import { db } from "@/lib/db";
import { bridgeEvents } from "@/drizzle/schema";
import { sql } from "drizzle-orm";
async function main(){
  // distinct event types + counts + last seen
  const rows = await db.select({
    type: bridgeEvents.type,
    c: sql<number>`count(*)`,
    last: sql<string>`max(${bridgeEvents.occurredAt})`,
  }).from(bridgeEvents).groupBy(bridgeEvents.type).orderBy(sql`max(${bridgeEvents.occurredAt}) DESC`);
  console.log("=== all bridge_events types (by last seen) ===");
  for(const r of rows) console.log(`  ${String(r.type).padEnd(34)} n=${String(r.c).padEnd(6)} last=${r.last?.slice?.(0,16)??r.last}`);
  const ghlApp = rows.filter(r=>String(r.type).startsWith("ghl_app."));
  console.log(`\n=== ghl_app.* events (Marketplace App webhook) : ${ghlApp.length} types ===`);
  for(const r of ghlApp) console.log(`  ${r.type} — n=${r.c}`);
  const taskEv = rows.filter(r=>/task/i.test(String(r.type)));
  console.log(`\n=== TASK events ever received: ${taskEv.length} ===`);
  for(const r of taskEv) console.log(`  ${r.type} — n=${r.c} last=${r.last?.slice?.(0,16)}`);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
