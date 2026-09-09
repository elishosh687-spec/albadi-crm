import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { eq, inArray } from "drizzle-orm";
import { buildFactoryRow, findLastDataRow, getSheetId, setCellDateFormat, setRowHeight, FEISHU_ROW_HEIGHT_PX, readRow } from "@/lib/feishu/sheets";
import { feishuFetch } from "@/lib/feishu/client";
import type { FactoryProductSpec } from "@/lib/factory/types";
const GO=process.argv.includes("--go");
const sizeLabel=(s:any)=>[s.heightCm&&`H${s.heightCm}`,s.depthCm&&`D${s.depthCm}`,s.widthCm&&`W${s.widthCm}`].filter(Boolean).join("*");
const token=process.env.FEISHU_SHEET_TOKEN!;
async function main(){
  const qnos=["7DSQAX35","4IVT9N69","8NN2PJS5"];
  const rows=await db.select({id:factoryQuoteRequests.id,q:factoryQuoteRequests.quotationNo,spec:factoryQuoteRequests.productSpec,name:leads.name})
    .from(factoryQuoteRequests).leftJoin(leads,eq(leads.manychatSubId,factoryQuoteRequests.manychatSubId)).where(inArray(factoryQuoteRequests.quotationNo,qnos));
  const sheetId=await getSheetId();
  const written:string[]=[];
  for(const r of rows){
    const spec=r.spec as FactoryProductSpec;
    const base=buildFactoryRow({customer:r.name??"",quotationNo:r.q??"",pic:(spec as any).picUrl??"",description:spec.description,material:spec.material,size:sizeLabel(spec),printing:spec.printing,finishing:spec.finishing,quantity:spec.quantity});
    // insert empty F (类型): A-E + "" + material,size,printing,finishing,quantity → A..K
    const fixed=[...base.slice(0,5),"",...base.slice(5)];
    console.log(`${r.q} → A..K: ${JSON.stringify(fixed)}`);
    if(GO){
      const target=(await findLastDataRow())+1;
      const range=`${sheetId}!A${target}:K${target}`;
      await feishuFetch(`/open-apis/sheets/v2/spreadsheets/${token}/values`,{method:"PUT",body:JSON.stringify({valueRange:{range,values:[fixed]}})});
      try{await setRowHeight(String(target),FEISHU_ROW_HEIGHT_PX);}catch{}
      try{await setCellDateFormat(String(target),"C");}catch{}
      await db.update(factoryQuoteRequests).set({feishuRowIndex:String(target),factoryStatus:"pending",updatedAt:new Date()}).where(eq(factoryQuoteRequests.id,r.id));
      written.push(String(target));
      console.log(`   ✓ wrote row ${target}`);
    }
  }
  if(GO){
    console.log("\n=== read-back verification ===");
    const L=(i:number)=>String.fromCharCode(65+i);
    for(const t of written){
      const cells=await readRow(t);
      console.log(` row ${t}: `+["A","B","E","F","G","H","I","J","K"].map(c=>{const i=c.charCodeAt(0)-65;return `${c}=${String(cells[i]??"").slice(0,18)||"∅"}`;}).join(" | "));
    }
  } else console.log("\n(preview — add --go to write)");
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
