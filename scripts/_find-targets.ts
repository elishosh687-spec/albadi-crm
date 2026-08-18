import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { sql } from "drizzle-orm";
async function main(){
  for(const n of ["תאומים","מלח","גולד","בייבי","יוסי","baby","gold","twin","סלט"]){
    const ls=await db.select({sid:leads.manychatSubId,name:leads.name,stage:leads.pipelineStage}).from(leads).where(sql`${leads.name} ILIKE ${'%'+n+'%'}`);
    if(ls.length){console.log(`"${n}":`);for(const l of ls)console.log(`   ${l.name} | sid=${l.sid} | ${l.stage??"NULL"}`);}
    else console.log(`"${n}": (none)`);
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
