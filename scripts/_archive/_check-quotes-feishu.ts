import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { inArray } from "drizzle-orm";
import { readAllRows } from "@/lib/feishu/sheets";
async function main(){
  const qnos=["7DSQAX35","4IVT9N69","8NN2PJS5"];
  console.log("=== DB rows for the 3 quotes ===");
  const rows=await db.select().from(factoryQuoteRequests).where(inArray(factoryQuoteRequests.quotationNo,qnos));
  for(const r of rows){
    const ps:any=r.productSpec??{};
    console.log(`\n  ${r.quotationNo} | feishuRowIndex=${r.feishuRowIndex??"(none — NOT in sheet)"} | status=${r.factoryStatus}`);
    console.log(`     spec: desc="${ps.description??ps.productName??""}" mat="${ps.material??""}" size="${ps.size??[ps.widthCm,ps.heightCm,ps.depthCm].filter(Boolean).join('×')}" qty=${ps.quantity??ps.qty??""} print="${ps.printing??ps.logoColors??""}" finish="${ps.finishing??""}"`);
  }
  console.log("\n=== Feishu sheet: are these quotes already there? ===");
  try{
    const grid=await readAllRows();
    console.log(`sheet rows read: ${grid.length}`);
    // header row 5 (index 4)
    const hdr=grid[4]??grid[0]??[];
    console.log("header row:", hdr.map((c:any,i:number)=>`${String.fromCharCode(65+i)}=${String(c).slice(0,10)}`).join(" | ").slice(0,300));
    for(const q of qnos){
      const found=grid.findIndex((row:any)=>row.some((c:any)=>String(c).trim()===q));
      console.log(`  ${q}: ${found>=0?`FOUND at row ${found+1}`:"NOT in sheet"}`);
    }
  }catch(e){console.log("feishu read failed:", e instanceof Error?e.message:e);}
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
