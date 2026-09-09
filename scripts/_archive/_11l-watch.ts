import { db } from "../lib/db";
import { sql } from "drizzle-orm";
async function count(): Promise<number> {
  const r: any = await db.execute(sql`SELECT count(*)::int n FROM elevenlabs_call_imports`);
  return (r.rows ?? r)[0].n;
}
async function main() {
  const start = await count();
  for (let i=0;i<13;i++) {
    const n = await count();
    if (n > start) {
      const b: any = await db.execute(sql`SELECT status, count(*)::int n FROM elevenlabs_call_imports GROUP BY status ORDER BY status`);
      console.log(`TRIGGER FIRED — rows ${start} -> ${n}`);
      for (const x of (b.rows??b)) console.log(`  ${x.status}: ${x.n}`);
      return;
    }
    await new Promise(r=>setTimeout(r,30000));
  }
  console.log(`no change after ~6.5min (still ${start} rows) — cron may not have ticked yet`);
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
