import { readAllRows } from "@/lib/feishu/sheets";
async function main(){
  const grid=await readAllRows();
  const isMat=(s:string)=>/non-woven|80g|克|gsm/i.test(s);
  const isSize=(s:string)=>/^[HDW]\d|[*×]\d|\d+\*\d+/i.test(s);
  console.log("recent request rows — where did MATERIAL land?");
  let aligned=0,misaligned=0,shown=0;
  for(let r=grid.length-1;r>=5 && shown<18;r--){
    const row=grid[r];if(!row)continue;
    const a=String(row[0]??"").trim(),b=String(row[1]??"").trim();
    if(!a||!/^[A-Z0-9]{8}$/.test(b))continue;
    const F=String(row[5]??"").trim(),G=String(row[6]??"").trim();
    let verdict="?";
    if(isMat(G)&&!F){verdict="✓ aligned (F empty, material@G)";aligned++;}
    else if(isMat(F)){verdict="✗ MISALIGNED (material@F)";misaligned++;}
    console.log(`  row ${r+1} ${b} ${a.slice(0,14).padEnd(14)} | F="${F.slice(0,14)}" G="${G.slice(0,14)}" → ${verdict}`);
    shown++;
  }
  console.log(`\naligned=${aligned}  misaligned=${misaligned}`);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
