import { setCellValue, readRow } from "@/lib/feishu/sheets";
async function main(){
  for(const row of ["44","45","46"]){
    await setCellValue(row,"E","Albadi non-woven bag");
    const cells=await readRow(row);
    console.log(`row ${row}: B=${cells[1]} | E="${cells[4]}"`);
  }
  console.log("✅ done");
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
