import { db } from "@/lib/db";
import { leads, ghlOauthTokens, factoryQuoteRequests } from "@/drizzle/schema";
import { desc, eq, sql } from "drizzle-orm";
const GHL_BASE="https://services.leadconnectorhq.com",V="2021-07-28";
async function main(){
  const tok=(await db.select().from(ghlOauthTokens).orderBy(desc(ghlOauthTokens.updatedAt)).limit(1))[0];
  const token=tok.accessToken,locationId=tok.locationId;
  async function search(qy:string){
    const u=new URL(`${GHL_BASE}/contacts/`);u.searchParams.set("locationId",locationId);u.searchParams.set("query",qy);u.searchParams.set("limit","10");
    const r=await fetch(u,{headers:{Authorization:`Bearer ${token}`,Version:V,Accept:"application/json"}});
    if(!r.ok){console.log(`  search "${qy}" → ${r.status}`);return [];}
    const j=await r.json();return (j.contacts??[]) as any[];
  }
  for(const name of ["מלח הארץ","תכשיטי התאומים","יוסי גולד בייבי"]){
    console.log(`\n=== "${name}" ===`);
    const cs=(await search(name)).filter(c=>(c.contactName??"").includes(name)|| name.includes(c.contactName??"@@"));
    for(const c of cs.slice(0,3)){
      console.log(`  GHL contact: "${c.contactName??c.firstName}" | id=${c.id} | phone="${c.phone??""}"`);
      const dbrows=await db.select({sid:leads.manychatSubId,name:leads.name}).from(leads).where(eq(leads.ghlContactId,c.id));
      if(dbrows.length){for(const d of dbrows){
        const qc=await db.select({c:sql<number>`count(*)`}).from(factoryQuoteRequests).where(eq(factoryQuoteRequests.manychatSubId,d.sid));
        console.log(`     → DB lead EXISTS: sid=${d.sid} name="${d.name}" (existing quotes: ${qc[0]?.c})`);
      }}
      else console.log(`     → NO DB lead for this contact (would need to create one, or sid must exist for quotes to attach)`);
    }
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
