import { readAllRows } from "@/lib/feishu/sheets";
async function main(){
  const grid=await readAllRows();
  const L=(i:number)=>String.fromCharCode(65+i);
  // header
  console.log("HEADER (row 5):");
  (grid[4]??[]).forEach((c:any,i:number)=>{if(String(c).trim())console.log(`  ${L(i)}: ${c}`);});
  // find recent data rows with a quotation-looking value in col B (8 chars alnum)
  console.log("\nRECENT APP-WRITTEN REQUEST ROWS (contact in A + qno in B):");
  let shown=0;
  for(let r=grid.length-1;r>=5 && shown<3;r--){
    const row=grid[r];if(!row)continue;
    const a=String(row[0]??"").trim(), b=String(row[1]??"").trim();
    if(a && /^[A-Z0-9]{8}$/.test(b)){
      console.log(`\n row ${r+1}:`);
      row.forEach((c:any,i:number)=>{if(String(c).trim())console.log(`   ${L(i)}: ${String(c).slice(0,30)}`);});
      shown++;
    }
  }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
