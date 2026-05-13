import "dotenv/config";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const rows = await db.execute(sql`
    SELECT COALESCE(pipeline_stage, '(NULL)') AS stage, count(*) AS n
    FROM leads
    WHERE active = true
    GROUP BY pipeline_stage
    ORDER BY n DESC
  `);
  console.log("active leads by stage:");
  for (const r of ((rows as any).rows ?? rows) as Array<{ stage: string; n: number }>) {
    console.log(`  ${r.stage.padEnd(20)} ${r.n}`);
  }

  const flags = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM leads WHERE active AND pipeline_flag = 'NEEDS_ELI') AS needs_eli,
      (SELECT count(*) FROM leads WHERE active AND bot_paused = true) AS paused,
      (SELECT count(*) FROM leads WHERE active AND follow_up_count > 0) AS followed
  `);
  console.log("\nflags:", ((flags as any).rows ?? flags)[0]);
}

main().catch(e => { console.error(e); process.exit(1); });
