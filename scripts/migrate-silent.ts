import "dotenv/config";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const before = await db.execute(sql`
    SELECT manychat_sub_id, name, phone_e164
    FROM leads
    WHERE active = true AND pipeline_stage = 'SILENT'
  `);
  const rows = ((before as any).rows ?? before) as Array<{ manychat_sub_id: string; name: string | null; phone_e164: string | null }>;
  console.log(`migrating ${rows.length} SILENT → NULL + NEEDS_ELI:`);
  for (const r of rows) {
    console.log(`  ${r.manychat_sub_id}  ${r.name ?? "(no name)"}  ${r.phone_e164 ?? ""}`);
  }

  const updated = await db.execute(sql`
    UPDATE leads
    SET pipeline_stage = NULL,
        pipeline_flag = 'NEEDS_ELI',
        updated_at = now()
    WHERE active = true AND pipeline_stage = 'SILENT'
    RETURNING manychat_sub_id
  `);
  console.log(`\nupdated ${((updated as any).rows ?? updated).length} rows`);

  const after = await db.execute(sql`
    SELECT
      (SELECT count(*) FROM leads WHERE active AND pipeline_stage = 'SILENT') AS still_silent,
      (SELECT count(*) FROM leads WHERE active AND pipeline_flag = 'NEEDS_ELI') AS needs_eli
  `);
  console.log("after:", ((after as any).rows ?? after)[0]);
}

main().catch(e => { console.error(e); process.exit(1); });
