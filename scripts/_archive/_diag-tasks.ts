import { db } from "@/lib/db";
import { leads, crmTasks } from "@/drizzle/schema";
import { sql, eq } from "drizzle-orm";
async function main(){
  const names=["אסתר","משה","אופק סמדר"];
  for(const n of names){
    const ls=await db.select({sid:leads.manychatSubId,name:leads.name,stage:leads.pipelineStage,active:leads.active,ghl:leads.ghlContactId})
      .from(leads).where(sql`${leads.name} LIKE ${'%'+n+'%'}`);
    for(const l of ls){
      const tasks=await db.select({title:crmTasks.title,status:crmTasks.status,completedAt:crmTasks.completedAt,ghlId:crmTasks.ghlTaskId})
        .from(crmTasks).where(eq(crmTasks.manychatSubId,l.sid));
      const open=tasks.filter(t=>!t.completedAt && t.status!=="completed");
      console.log(`\n${l.name} | stage=${l.stage??"NULL"} active=${l.active} | tasks=${tasks.length} OPEN=${open.length}`);
      for(const t of tasks) console.log(`   [${(!t.completedAt&&t.status!=="completed")?"OPEN":"done"}] "${(t.title??"").slice(0,40)}" status=${t.status} completedAt=${t.completedAt?.toISOString?.()?.slice(0,10)??"—"} ghlTaskId=${t.ghlId?"yes":"NO"}`);
    }
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
