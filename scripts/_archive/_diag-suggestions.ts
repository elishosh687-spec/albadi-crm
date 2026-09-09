import { db } from "@/lib/db";
import { leads, ghlOauthTokens } from "@/drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { runPipelineAudit } from "@/lib/analysis/pipeline-audit";

const GHL_BASE="https://services.leadconnectorhq.com", V="2021-07-28";
function nameToEnum(n:string){const m:Record<string,string>={"קליטה":"INTAKE","אפיון":"DISCAVERY","מחכה למפעל":"FACTORY_WAIT","משא ומתן":"CONSIDERATION","נסגר":"WON","לא נסגר":"LOST","להתקשר בעתיד":"FUTURE_FOLLOW_UP","לא ענו":"NO_RESPONSE_REENGAGE"};return m[n.trim()]??`?(${n})`;}
async function ghl(p:string,t:string,q?:any){const u=new URL(GHL_BASE+p);if(q)for(const[k,v]of Object.entries(q))u.searchParams.set(k,String(v));const r=await fetch(u,{headers:{Authorization:`Bearer ${t}`,Version:V,Accept:"application/json"}});if(!r.ok)throw new Error(`${p} ${r.status}`);return r.json();}
async function main(){
  const tok=(await db.select().from(ghlOauthTokens).orderBy(desc(ghlOauthTokens.updatedAt)).limit(1))[0];
  const token=tok.accessToken,locationId=tok.locationId;
  const pl=await ghl("/opportunities/pipelines",token,{locationId});
  const pipeline=pl.pipelines.find((p:any)=>(p.stages??[]).some((s:any)=>nameToEnum(s.name)==="DISCAVERY"));
  const stageName=new Map<string,string>();for(const s of pipeline.stages)stageName.set(s.id,s.name);
  const truth=new Map<string,string>();let a:string|undefined,ai:string|undefined,pg=0;
  do{const q:any={location_id:locationId,pipeline_id:pipeline.id,limit:100};if(a)q.startAfter=a;if(ai)q.startAfterId=ai;const r=await ghl("/opportunities/search",token,q);for(const o of r.opportunities??[])if(o.contactId)truth.set(o.contactId,nameToEnum(stageName.get(o.pipelineStageId)??""));a=r.meta?.startAfter;ai=r.meta?.startAfterId;pg++;if(!(r.opportunities??[]).length)break;}while(a&&ai&&pg<40);

  const audit=await runPipelineAudit();
  const ghlBySid=new Map<string,string>();
  const rows=await db.select({sid:leads.manychatSubId,ghl:leads.ghlContactId}).from(leads);
  for(const r of rows)if(r.ghl&&truth.get(r.ghl))ghlBySid.set(r.sid,truth.get(r.ghl)!);

  console.log("suggested → | name | DB current | GHL LIVE | match?");
  let mismatch=0;
  for(const r of audit.stageLag){
    const ghlLive=ghlBySid.get(r.sid)??"(no-opp)";
    const dbCur=r.currentStage??"NULL";
    const ok = ghlLive===dbCur || ghlLive==="(no-opp)";
    if(!ok)mismatch++;
    console.log(`  →${r.suggestedStage.padEnd(13)} | ${(r.name??"—").padEnd(20)} | DB=${dbCur.padEnd(13)} | GHL=${ghlLive.padEnd(20)} | ${ok?"✓":"✗ MISMATCH"}`);
  }
  console.log(`\nrows where DB≠GHL: ${mismatch}`);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
