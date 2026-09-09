import { db } from "@/lib/db";
import { leads, ghlOauthTokens, messages } from "@/drizzle/schema";
import { desc, eq, sql } from "drizzle-orm";

const GHL_BASE = "https://services.leadconnectorhq.com", V = "2021-07-28";
function nameToEnum(n: string): string {
  const m: Record<string, string> = { "קליטה":"INTAKE","אפיון":"DISCAVERY","מחכה למפעל":"FACTORY_WAIT","משא ומתן":"CONSIDERATION","נסגר":"WON","לא נסגר":"LOST","להתקשר בעתיד":"FUTURE_FOLLOW_UP","לא ענו":"NO_RESPONSE_REENGAGE" };
  return m[n.trim()] ?? `?(${n})`;
}
async function ghl(path: string, token: string, params?: Record<string,string|number>) {
  const url = new URL(GHL_BASE + path);
  if (params) for (const [k,v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const r = await fetch(url, { headers: { Authorization:`Bearer ${token}`, Version:V, Accept:"application/json" } });
  if (!r.ok) throw new Error(`${path} ${r.status}`); return r.json() as Promise<any>;
}
async function main() {
  const GO = process.argv.includes("--go");
  const tok = (await db.select().from(ghlOauthTokens).orderBy(desc(ghlOauthTokens.updatedAt)).limit(1))[0];
  const token = tok.accessToken, locationId = tok.locationId;
  const pl = await ghl("/opportunities/pipelines", token, { locationId });
  const pipeline = pl.pipelines.find((p:any)=>(p.stages??[]).some((s:any)=>nameToEnum(s.name)==="DISCAVERY"));
  const stageName = new Map<string,string>(); for (const s of pipeline.stages) stageName.set(s.id, s.name);
  const truth = new Map<string,string>();
  let after:string|undefined, afterId:string|undefined, page=0;
  do { const q:any={location_id:locationId,pipeline_id:pipeline.id,limit:100}; if(after)q.startAfter=after; if(afterId)q.startAfterId=afterId;
    const r=await ghl("/opportunities/search",token,q);
    for (const o of r.opportunities??[]) if(o.contactId) truth.set(o.contactId, nameToEnum(stageName.get(o.pipelineStageId)??""));
    after=r.meta?.startAfter; afterId=r.meta?.startAfterId; page++; if(!(r.opportunities??[]).length)break;
  } while(after&&afterId&&page<40);

  const rows = await db.select({ sid:leads.manychatSubId, name:leads.name, stage:leads.pipelineStage, ghl:leads.ghlContactId, src:leads.source, leadSrc:leads.leadSource, created:leads.createdAt }).from(leads).where(eq(leads.active,true));

  // (1) The 4 LOST↔GHL — sync to GHL
  const lostFix = rows.filter(l => l.ghl && l.stage === "LOST" && truth.get(l.ghl!) && truth.get(l.ghl!) !== "LOST" && !truth.get(l.ghl!)!.startsWith("?("));
  console.log(`=== LOST → GHL (${lostFix.length}) ===`);
  for (const l of lostFix) {
    const to = truth.get(l.ghl!)!;
    console.log(`  ${l.name} : LOST → ${to}`);
    if (GO) await db.update(leads).set({ pipelineStage: to, updatedAt: new Date() }).where(eq(leads.manychatSubId, l.sid));
  }

  // (2) no-opp leads — active, has ghl_contact_id, but no opportunity in GHL
  const noOpp = rows.filter(l => l.ghl && !truth.get(l.ghl!));
  console.log(`\n=== NO GHL OPPORTUNITY (${noOpp.length}) ===`);
  for (const l of noOpp) {
    const msgCount = (await db.select({ c: sql<number>`count(*)` }).from(messages).where(eq(messages.manychatSubId, l.sid)))[0]?.c ?? 0;
    console.log(`  ${(l.name??"—").padEnd(22)} stage=${l.stage??"NULL"} src=${l.src??"—"}/${l.leadSrc??"—"} created=${l.created?.toISOString()?.slice(0,10)} msgs=${msgCount} ghl=${l.ghl?.slice(0,10)}`);
  }
  console.log(GO ? "\n✅ applied LOST fixes" : "\n(dry-run — pass --go to apply the LOST fixes)");
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
