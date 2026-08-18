import { db } from "@/lib/db";
import { leads, ghlOauthTokens } from "@/drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { runPipelineAudit } from "@/lib/analysis/pipeline-audit";
const GO=process.argv.includes("--go");
const GHL_BASE="https://services.leadconnectorhq.com",V="2021-07-28";
function nameToEnum(n:string){const m:Record<string,string>={"קליטה":"INTAKE","אפיון":"DISCAVERY","מחכה למפעל":"FACTORY_WAIT","משא ומתן":"CONSIDERATION","נסגר":"WON","לא נסגר":"LOST","להתקשר בעתיד":"FUTURE_FOLLOW_UP","לא ענו":"NO_RESPONSE_REENGAGE"};return m[n.trim()]??`?(${n})`;}
async function ghl(p:string,t:string,q?:any){const u=new URL(GHL_BASE+p);if(q)for(const[k,v]of Object.entries(q))u.searchParams.set(k,String(v));const r=await fetch(u,{headers:{Authorization:`Bearer ${t}`,Version:V,Accept:"application/json"}});if(!r.ok)throw new Error(`${p} ${r.status}`);return r.json();}
async function main(){
  const tok=(await db.select().from(ghlOauthTokens).orderBy(desc(ghlOauthTokens.updatedAt)).limit(1))[0];
  const token=tok.accessToken,locationId=tok.locationId;
  const pl=await ghl("/opportunities/pipelines",token,{locationId});
  const pipeline=pl.pipelines.find((p:any)=>(p.stages??[]).some((s:any)=>nameToEnum(s.name)==="DISCAVERY"));
  const stageName=new Map<string,string>();for(const s of pipeline.stages)stageName.set(s.id,s.name);
  const truth=new Map<string,string>();let a:string|undefined,ai:string|undefined,pg=0;
  do{const q:any={location_id:locationId,pipeline_id:pipeline.id,limit:100};if(a)q.startAfter=a;if(ai)q.startAfterId=ai;const r=await ghl("/opportunities/search",token,q);
    for(const o of r.opportunities??[]){if(!o.contactId)continue;let loc;if(o.status==="won")loc="WON";else if(o.status==="lost")loc="LOST";else loc=nameToEnum(stageName.get(o.pipelineStageId)??"");truth.set(o.contactId,loc);}
    a=r.meta?.startAfter;ai=r.meta?.startAfterId;pg++;if(!(r.opportunities??[]).length)break;}while(a&&ai&&pg<40);
  const rows=await db.select({sid:leads.manychatSubId,name:leads.name,stage:leads.pipelineStage,ghl:leads.ghlContactId}).from(leads).where(eq(leads.active,true));
  let fixed=0;
  for(const l of rows){if(!l.ghl)continue;const g=truth.get(l.ghl);if(!g||g.startsWith("?("))continue;const cur=l.stage??"NULL";if(cur===g)continue;console.log(`  ${l.name}: ${cur} → ${g}`);if(GO)await db.update(leads).set({pipelineStage:g,updatedAt:new Date()}).where(eq(leads.manychatSubId,l.sid));fixed++;}
  console.log(`\n${GO?"fixed":"would fix"} ${fixed}`);
  if(GO){const audit=await runPipelineAudit();console.log(`audit noTask=${audit.noTask.length}`);const idan=audit.noTask.find(n=>n.name?.includes("עידן"));console.log(idan?`⚠️ עידן STILL in between-chairs`:`✓ עידן no longer in between-chairs`);}
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
