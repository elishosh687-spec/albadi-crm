import { db } from "@/lib/db";
import { leads, ghlOauthTokens } from "@/drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { runPipelineAudit } from "@/lib/analysis/pipeline-audit";
const GHL_BASE="https://services.leadconnectorhq.com",V="2021-07-28";
function nameToEnum(n:string){const m:Record<string,string>={"קליטה":"INTAKE","אפיון":"DISCAVERY","מחכה למפעל":"FACTORY_WAIT","משא ומתן":"CONSIDERATION","נסגר":"WON","לא נסגר":"LOST","להתקשר בעתיד":"FUTURE_FOLLOW_UP","לא ענו":"NO_RESPONSE_REENGAGE"};return m[n.trim()]??`?(${n})`;}
async function ghl(p:string,t:string,q?:any){const u=new URL(GHL_BASE+p);if(q)for(const[k,v]of Object.entries(q))u.searchParams.set(k,String(v));const r=await fetch(u,{headers:{Authorization:`Bearer ${t}`,Version:V,Accept:"application/json"}});if(!r.ok)throw new Error(`${p} ${r.status}`);return r.json();}
async function main(){
  const tok=(await db.select().from(ghlOauthTokens).orderBy(desc(ghlOauthTokens.updatedAt)).limit(1))[0];
  const token=tok.accessToken,locationId=tok.locationId;
  const pl=await ghl("/opportunities/pipelines",token,{locationId});
  const pipeline=pl.pipelines.find((p:any)=>(p.stages??[]).some((s:any)=>nameToEnum(s.name)==="DISCAVERY"));
  const stageName=new Map<string,string>();for(const s of pipeline.stages)stageName.set(s.id,s.name);
  const col=new Map<string,string>(),stat=new Map<string,string>();let a:string|undefined,ai:string|undefined,pg=0;
  do{const q:any={location_id:locationId,pipeline_id:pipeline.id,limit:100};if(a)q.startAfter=a;if(ai)q.startAfterId=ai;const r=await ghl("/opportunities/search",token,q);
    for(const o of r.opportunities??[]){if(!o.contactId)continue;col.set(o.contactId,nameToEnum(stageName.get(o.pipelineStageId)??""));stat.set(o.contactId,o.status??"");}
    a=r.meta?.startAfter;ai=r.meta?.startAfterId;pg++;if(!(r.opportunities??[]).length)break;}while(a&&ai&&pg<40);
  // map sid->ghl
  const all=await db.select({sid:leads.manychatSubId,ghl:leads.ghlContactId}).from(leads);
  const ghlBySid=new Map(all.filter(r=>r.ghl).map(r=>[r.sid,r.ghl!]));
  const audit=await runPipelineAudit();
  console.log(`between-chairs (${audit.noTask.length}) — DB stage | GHL column | GHL status\n`);
  let bad=0;
  for(const n of audit.noTask){
    const g=ghlBySid.get(n.sid);const c=g?col.get(g):undefined;const s=g?stat.get(g):undefined;
    const isLost = c==="LOST"||c==="WON"||s==="lost"||s==="won";
    if(isLost)bad++;
    console.log(`  ${(n.name??"—").padEnd(24)} DB=${(n.currentStage??"NULL").padEnd(13)} | GHLcol=${(c??"(no-opp)").padEnd(14)} | status=${s??"—"} ${isLost?"  ⚠️ SHOULD BE EXCLUDED":""}`);
  }
  console.log(`\nleads that are actually closed but still shown: ${bad}`);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
