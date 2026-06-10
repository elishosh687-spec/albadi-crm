import { db } from "../lib/db";
import { sql } from "drizzle-orm";
async function main() {
  const r: any = await db.execute(sql`SELECT status, count(*)::int n FROM elevenlabs_call_imports GROUP BY status ORDER BY status`);
  const rows = r.rows ?? r;
  const total = rows.reduce((s:number,x:any)=>s+x.n,0);
  console.log(`elevenlabs_call_imports: ${total} rows`);
  for (const x of rows) console.log(`  ${x.status}: ${x.n}`);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
