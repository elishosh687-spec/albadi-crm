import { db } from "@/lib/db";
import { leads, factoryQuoteRequests } from "@/drizzle/schema";
import { sql, inArray } from "drizzle-orm";
async function main(){
  const qnos=["7DSQAX35","4IVT9N69","8NN2PJS5","2S1VXFMY","4TIMEAL4","U1SL6F4Y"];
  console.log("=== the 6 quotes: current owner ===");
  const qs=await db.select({q:factoryQuoteRequests.quotationNo,sid:factoryQuoteRequests.manychatSubId,name:factoryQuoteRequests.leadName??sql`NULL`,created:factoryQuoteRequests.createdAt}).from(factoryQuoteRequests).where(inArray(factoryQuoteRequests.quotationNo,qnos));
  for(const q of qs){
    const l=await db.select({name:leads.name}).from(leads).where(sql`${leads.manychatSubId}=${q.sid}`);
    console.log(`  ${q.q?.padEnd(10)} → sid ${q.sid?.slice(0,20).padEnd(20)} | lead="${l[0]?.name??"?"}"`);
  }
  const missing=qnos.filter(q=>!qs.find(r=>r.q===q));
  if(missing.length)console.log("  NOT FOUND:",missing.join(", "));

  console.log("\n=== target leads (do they exist?) ===");
  for(const n of ["תכשיטי התאומים","מלח הארץ","יוסי גולד","גולד בייבי"]){
    const ls=await db.select({sid:leads.manychatSubId,name:leads.name,stage:leads.pipelineStage,active:leads.active}).from(leads).where(sql`${leads.name} LIKE ${'%'+n+'%'}`);
    if(!ls.length){console.log(`  "${n}": (none)`);continue;}
    for(const l of ls)console.log(`  "${n}" → ${l.name} | sid=${l.sid?.slice(0,24)} | stage=${l.stage??"NULL"} active=${l.active}`);
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
