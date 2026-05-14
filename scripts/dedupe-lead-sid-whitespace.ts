import "dotenv/config";
import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const apply = process.argv.includes("--apply");

  // Find leads where trim(sid) collides with another row's sid. Strategy:
  // keep the row whose sid has NO trailing/leading whitespace (the cleaner
  // variant); rewrite all dependent rows (messages, lead_tags, bot_drafts)
  // to point at the kept sid; delete the others.
  const groups = await db.execute(sql`
    SELECT trim(manychat_sub_id) AS k, COUNT(*)::int AS n,
           array_agg(manychat_sub_id) AS variants
    FROM leads
    GROUP BY trim(manychat_sub_id)
    HAVING COUNT(*) > 1
    ORDER BY n DESC
  `);
  console.log("dup groups:", groups.rows.length);
  for (const g of groups.rows) {
    console.log("  -", JSON.stringify(g.k), "variants=" + JSON.stringify(g.variants));
  }

  if (!apply) {
    console.log("\n[DRY] not changing. re-run with --apply.");
    process.exit(0);
  }

  // Per group: pick the canonical sid = trimmed value, rewrite refs, delete others.
  for (const g of groups.rows) {
    const canonical = String(g.k);
    const variants = g.variants as string[];
    const losers = variants.filter((v) => v !== canonical);
    console.log("\ngroup", JSON.stringify(canonical), "losers=" + JSON.stringify(losers));

    // Ensure a row with the canonical sid exists. If only space-variants exist,
    // rename one of them to canonical first.
    const hasCanonical = variants.includes(canonical);
    if (!hasCanonical) {
      const pickOne = losers.shift()!;
      console.log("  rename", JSON.stringify(pickOne), "→", JSON.stringify(canonical));
      await db.execute(sql`UPDATE leads SET manychat_sub_id = ${canonical} WHERE manychat_sub_id = ${pickOne}`);
      await db.execute(sql`UPDATE messages SET manychat_sub_id = ${canonical} WHERE manychat_sub_id = ${pickOne}`);
      await db.execute(sql`UPDATE lead_tags SET manychat_sub_id = ${canonical} WHERE manychat_sub_id = ${pickOne}`);
      await db.execute(sql`UPDATE bot_drafts SET manychat_sub_id = ${canonical} WHERE manychat_sub_id = ${pickOne}`);
    }

    for (const loser of losers) {
      console.log("  merge+drop", JSON.stringify(loser));
      await db.execute(sql`UPDATE messages SET manychat_sub_id = ${canonical} WHERE manychat_sub_id = ${loser}`);
      await db.execute(sql`UPDATE lead_tags SET manychat_sub_id = ${canonical} WHERE manychat_sub_id = ${loser}`);
      await db.execute(sql`UPDATE bot_drafts SET manychat_sub_id = ${canonical} WHERE manychat_sub_id = ${loser}`);
      await db.execute(sql`DELETE FROM leads WHERE manychat_sub_id = ${loser}`);
    }
  }

  console.log("\ndone.");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
