import { db } from "@/lib/db";
import { leads, crmTasks, ghlOauthTokens } from "@/drizzle/schema";
import { and, eq, inArray, isNotNull, isNull, ne, or, sql, desc } from "drizzle-orm";
import { runPipelineAudit } from "@/lib/analysis/pipeline-audit";

const GO = process.argv.includes("--go");
const GHL_BASE="https://services.leadconnectorhq.com", V="2021-07-28";
const ACTIVE=["INTAKE","DISCAVERY","FACTORY_WAIT","CONSIDERATION"];

async function main(){
  const tok=(await db.select().from(ghlOauthTokens).orderBy(desc(ghlOauthTokens.updatedAt)).limit(1))[0];
  const token=tok.accessToken;
  async function ghlTasks(contactId:string){
    const r=await fetch(`${GHL_BASE}/contacts/${contactId}/tasks`,{headers:{Authorization:`Bearer ${token}`,Version:V,Accept:"application/json"}});
    if(!r.ok)throw new Error(`tasks ${r.status}`);
    const j=await r.json(); return (j.tasks??[]) as any[];
  }
  const rows=await db.select({sid:leads.manychatSubId,name:leads.name,ghl:leads.ghlContactId}).from(leads).where(and(
    eq(leads.active,true), isNotNull(leads.ghlContactId),
    or(isNull(leads.pipelineStage), inArray(leads.pipelineStage,ACTIVE)),
    sql`EXISTS (SELECT 1 FROM ${crmTasks} WHERE ${crmTasks.manychatSubId}=${leads.manychatSubId} AND ${crmTasks.completedAt} IS NULL AND ${crmTasks.status}<>'completed')`
  ));
  console.log(`active leads w/ open db task: ${rows.length}`);
  let closed=0, leadsFreed=0;
  for(const r of rows){
    let gt:any[]; try{gt=await ghlTasks(r.ghl!);}catch{continue;}
    const doneIds=new Set(gt.filter(t=>t.completed).map(t=>t.id));
    const liveIds=new Set(gt.map(t=>t.id));
    const dbOpen=await db.select({id:crmTasks.id,ghlId:crmTasks.ghlTaskId,title:crmTasks.title}).from(crmTasks).where(and(eq(crmTasks.manychatSubId,r.sid),isNull(crmTasks.completedAt),ne(crmTasks.status,"completed")));
    let closedHere=0;
    for(const t of dbOpen){
      if(!t.ghlId)continue;
      if(doneIds.has(t.ghlId)||(gt.length>0&&!liveIds.has(t.ghlId))){
        if(GO)await db.update(crmTasks).set({status:"completed",completedAt:new Date(),updatedAt:new Date()}).where(eq(crmTasks.id,t.id));
        closed++; closedHere++;
      }
    }
    if(closedHere===dbOpen.length && dbOpen.length>0){ leadsFreed++; console.log(`  ${r.name}: closed ${closedHere}/${dbOpen.length} → now between-chairs`); }
  }
  console.log(`\n${GO?"CLOSED":"would close"} ${closed} stale tasks | ${leadsFreed} leads become between-chairs`);
  if(GO){ const a=await runPipelineAudit(); console.log(`audit now: noTask=${a.noTask.length}`); for(const n of a.noTask)console.log(`   • ${n.name} (${n.currentStage??"NULL"})`); }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
