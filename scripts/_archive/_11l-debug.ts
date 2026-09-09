import { db } from "../lib/db";
import { sql } from "drizzle-orm";
async function main() {
  console.log("=== elevenlabs_call_imports ===");
  const r: any = await db.execute(sql`SELECT conversation_id, status, phone, direction, posted_back_at, last_error, updated_at FROM elevenlabs_call_imports ORDER BY updated_at DESC LIMIT 20`);
  for (const x of (r.rows??r)) console.log(`${x.updated_at} | ${x.status} | phone=${x.phone??"-"} dir=${x.direction??"-"} | posted=${x.posted_back_at?"Y":"-"} | err=${x.last_error??""} | ${x.conversation_id}`);
  console.log("\n=== cursor ===");
  const c: any = await db.execute(sql`SELECT value, updated_at FROM app_config WHERE key='elevenlabs.last_polled_unix'`);
  console.log((c.rows??c)[0] ? JSON.stringify((c.rows??c)[0]) : "(no cursor — sync never ran)");
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
