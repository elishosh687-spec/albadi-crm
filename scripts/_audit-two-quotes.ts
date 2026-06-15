/**
 * One-off: audit why quotationNos 1XM6TMED + 15JQUZLK aren't syncing from Feishu.
 *
 * Run:
 *   cd ~/Projects/albadi-crm && DATABASE_URL="$(~/.local/node/bin/neonctl connection-string --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)" npx tsx scripts/_audit-two-quotes.ts
 *
 * Does NOT touch Feishu — pure DB read. (Feishu probe needs FEISHU_APP_ID
 * etc. which only exist in Vercel env; if those happen to be in .env locally
 * we'll probe, otherwise just print the DB picture.)
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";

const CODES = ["1XM6TMED", "15JQUZLK"];

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");
  const sql = neon(process.env.DATABASE_URL);

  const rows = (await sql`
    SELECT
      id,
      manychat_sub_id,
      quotation_no,
      factory_status,
      feishu_row_index,
      (factory_response IS NOT NULL) AS has_response,
      (final_pricing IS NOT NULL)    AS has_final_pricing,
      sent_to_customer_at,
      created_at,
      updated_at,
      product_spec->>'finishing'  AS finishing,
      product_spec->>'description' AS description,
      product_spec->>'quantity'  AS quantity,
      factory_response->>'unitCostCny' AS unit_cost_cny
    FROM factory_quote_requests
    WHERE upper(quotation_no) = ANY(${CODES})
    ORDER BY created_at DESC
  `) as Array<Record<string, unknown>>;

  console.log(`\n=== factory_quote_requests rows for ${CODES.join(", ")} ===`);
  console.log(`Found ${rows.length} row(s) by exact quotation_no.\n`);
  for (const r of rows) {
    console.log(JSON.stringify(r, null, 2));
    console.log("---");
  }

  // Also find any sibling rows for the same lead — to detect "edit + resend" clones
  // that gave the quote a different quotationNo.
  if (rows.length > 0) {
    const subIds = Array.from(new Set(rows.map((r) => r.manychat_sub_id as string)));
    const siblings = (await sql`
      SELECT
        id,
        manychat_sub_id,
        quotation_no,
        factory_status,
        feishu_row_index,
        (factory_response IS NOT NULL) AS has_response,
        sent_to_customer_at,
        created_at,
        product_spec->>'finishing' AS finishing
      FROM factory_quote_requests
      WHERE manychat_sub_id = ANY(${subIds})
      ORDER BY manychat_sub_id, created_at DESC
    `) as Array<Record<string, unknown>>;
    console.log(`\n=== ALL quotes for the same lead(s) — looking for clones ===\n`);
    for (const r of siblings) {
      console.log(
        `lead=${r.manychat_sub_id} | qNo=${r.quotation_no} | status=${r.factory_status} | feishuRow=${r.feishu_row_index ?? "—"} | hasResp=${r.has_response} | sentToCust=${r.sent_to_customer_at ? "yes" : "no"} | finishing="${r.finishing}" | created=${r.created_at}`
      );
    }
  }

  // Lead name/phone for context
  if (rows.length > 0) {
    const subIds = Array.from(new Set(rows.map((r) => r.manychat_sub_id as string)));
    const leads = (await sql`
      SELECT manychat_sub_id, name, phone_e164, stage
      FROM leads
      WHERE manychat_sub_id = ANY(${subIds})
    `) as Array<Record<string, unknown>>;
    console.log(`\n=== Lead context ===`);
    for (const l of leads) console.log(JSON.stringify(l));
  }

  console.log("\n=== Diagnosis ===");
  for (const code of CODES) {
    const match = rows.find(
      (r) => String(r.quotation_no).toUpperCase() === code
    );
    if (!match) {
      console.log(`${code}: not_in_db`);
      continue;
    }
    const status = match.factory_status;
    const idx = match.feishu_row_index;
    if (status !== "pending") {
      console.log(
        `${code}: not_pending (status=${status}) — refresh skips this row. ${
          match.has_response ? "Factory already answered." : "No factory response stored."
        }`
      );
    } else if (!idx) {
      console.log(`${code}: pending but feishu_row_index=NULL — never appended to sheet (or got cleared).`);
    } else {
      console.log(`${code}: pending + has feishu_row_index=${idx} — should be syncing. Check Feishu col B at row ${idx} matches the code, and that col K (unit cost) is filled.`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
