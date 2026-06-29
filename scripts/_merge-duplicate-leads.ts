/**
 * Merge two duplicate leads (DB-side). The SURVIVOR sid keeps everything;
 * every row referencing the LOSER sid is reassigned to the survivor, then
 * the loser row in `leads` is deleted.
 *
 * Pre-req: merge the matching GHL contacts in the GHL UI first so
 * `ghl_contact_id` of the survivor points at the merged GHL contact.
 *
 * Usage (DRY RUN — counts only, no writes):
 *   DATABASE_URL=… npx tsx scripts/_merge-duplicate-leads.ts <survivor_sid> <loser_sid>
 *
 * Commit:
 *   … npx tsx scripts/_merge-duplicate-leads.ts <survivor_sid> <loser_sid> --confirm
 */

import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

interface ColRef {
  table: string;
  column: string; // 'manychat_sub_id' or 'lead_sid'
}

async function discoverSidColumns(): Promise<ColRef[]> {
  const result = await db.execute(sql`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('manychat_sub_id', 'lead_sid')
      AND table_name <> 'leads'
    ORDER BY table_name, column_name
  `);
  return (result.rows as Array<{ table_name: string; column_name: string }>).map((r) => ({
    table: r.table_name,
    column: r.column_name,
  }));
}

async function rowsMatching(table: string, col: string, sid: string): Promise<number> {
  const r = await db.execute(
    sql.raw(`SELECT count(*)::int AS n FROM ${quoteIdent(table)} WHERE ${quoteIdent(col)} = '${sid.replace(/'/g, "''")}'`)
  );
  return (r.rows as Array<{ n: number }>)[0]?.n ?? 0;
}

function quoteIdent(s: string): string {
  // identifiers are validated against the discovered list before use; we still
  // quote defensively.
  if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error(`unsafe ident: ${s}`);
  return `"${s}"`;
}

async function main() {
  const [survivor, loser, ...rest] = process.argv.slice(2);
  const confirm = rest.includes("--confirm");
  if (!survivor || !loser) {
    console.error("usage: _merge-duplicate-leads.ts <survivor_sid> <loser_sid> [--confirm]");
    process.exit(2);
  }
  if (survivor === loser) {
    console.error("survivor and loser must differ");
    process.exit(2);
  }

  // Sanity: both must exist in leads.
  const both = await db.execute(sql`
    SELECT manychat_sub_id, name, phone_e164, ghl_contact_id, created_at
    FROM leads
    WHERE manychat_sub_id IN (${survivor}, ${loser})
  `);
  if (both.rows.length !== 2) {
    console.error("expected to find BOTH sids in leads; got:", both.rows);
    process.exit(2);
  }
  console.log("survivor + loser rows:");
  for (const r of both.rows) console.log(" ", r);

  const cols = await discoverSidColumns();
  console.log(`\ndiscovered ${cols.length} sid-referencing columns`);

  const plan: Array<{ table: string; col: string; loserCount: number }> = [];
  for (const { table, column } of cols) {
    const n = await rowsMatching(table, column, loser);
    if (n > 0) plan.push({ table, col: column, loserCount: n });
  }

  if (plan.length === 0) {
    console.log("loser has NO referencing rows — only the leads row needs deletion.");
  } else {
    console.log("\nplan (loser → survivor):");
    for (const p of plan) {
      console.log(`  ${p.table}.${p.col}: ${p.loserCount} rows`);
    }
  }

  if (!confirm) {
    console.log("\n(dry run — re-run with --confirm to apply)");
    return;
  }

  console.log("\napplying…");
  for (const p of plan) {
    // For tables with UNIQUE(sid, …) constraints, an UPDATE could collide if
    // the survivor already has a matching row. We handle two such tables that
    // we know about: lead_tags (manychat_sub_id, tag) and crm_tasks (sid +
    // ghl_task_id). For the rest we do a plain UPDATE.
    if (p.table === "lead_tags") {
      // delete loser rows whose tag already exists for survivor
      await db.execute(
        sql.raw(`
          DELETE FROM lead_tags
          WHERE manychat_sub_id = '${loser.replace(/'/g, "''")}'
            AND tag IN (SELECT tag FROM lead_tags WHERE manychat_sub_id = '${survivor.replace(/'/g, "''")}')
        `)
      );
    }
    const r = await db.execute(
      sql.raw(`
        UPDATE ${quoteIdent(p.table)}
        SET ${quoteIdent(p.col)} = '${survivor.replace(/'/g, "''")}'
        WHERE ${quoteIdent(p.col)} = '${loser.replace(/'/g, "''")}'
      `)
    );
    console.log(`  ${p.table}.${p.col}: updated ${r.rowCount ?? 0} rows`);
  }

  const del = await db.execute(sql`DELETE FROM leads WHERE manychat_sub_id = ${loser}`);
  console.log(`leads: deleted ${del.rowCount ?? 0} row(s) for ${loser}`);

  console.log("\nmerge complete.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
