import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import { appendRow, buildFactoryRow, setRowHeight, setCellDateFormat, FEISHU_ROW_HEIGHT_PX } from "@/lib/feishu/sheets";
import type { FactoryProductSpec } from "@/lib/factory/types";
const GO=process.argv.includes("--go");
const sizeLabel=(s:any)=>[s.heightCm&&`H${s.heightCm}`,s.depthCm&&`D${s.depthCm}`,s.widthCm&&`W${s.widthCm}`].filter(Boolean).join("*");
async function main(){
  const qnos=["7DSQAX35","4IVT9N69","8NN2PJS5"];
  const rows=await db.select({id:factoryQuoteRequests.id,q:factoryQuoteRequests.quotationNo,spec:factoryQuoteRequests.productSpec,name:leads.name})
    .from(factoryQuoteRequests).leftJoin(leads,eq(leads.manychatSubId,factoryQuoteRequests.manychatSubId)).where(inArray(factoryQuoteRequests.quotationNo,qnos));
  console.log(`${GO?"APPENDING":"PREVIEW (no write)"}\n`);
  for(const r of rows){
    const spec=r.spec as FactoryProductSpec;
    const rowVals=buildFactoryRow({customer:r.name??"",quotationNo:r.q??"",pic:(spec as any).picUrl??"",description:spec.description,material:spec.material,size:sizeLabel(spec),printing:spec.printing,finishing:spec.finishing,quantity:spec.quantity});
    console.log(`  ${r.q} → row: ${JSON.stringify(rowVals)}`);
    if(GO){
      const idx=await appendRow(rowVals);
      try{await setRowHeight(idx,FEISHU_ROW_HEIGHT_PX);}catch{}
      try{await setCellDateFormat(idx,"C");}catch{}
      await db.update(factoryQuoteRequests).set({feishuRowIndex:idx,factoryStatus:"pending",updatedAt:new Date()}).where(eq(factoryQuoteRequests.id,r.id));
      console.log(`     ✓ appended at Feishu row ${idx}`);
    }
  }
  console.log(GO?"\n✅ done":"\n(preview — add --go to write to Feishu)");
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
