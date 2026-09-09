/**
 * Probe all factory quotes for אבי (972522839603) to figure out where
 * ZL86RY63 came from. Show every row + match against Feishu.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { readAllRows, baseQuoteNo } from "@/lib/feishu/sheets";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const dbRows = (await sql`
    SELECT id, quotation_no, factory_status, feishu_row_index,
           created_at, updated_at, pdf_url IS NOT NULL AS has_pdf,
           product_spec->>'description' AS description,
           product_spec->>'quantity' AS qty,
           product_spec->>'printing' AS printing,
           product_spec->>'finishing' AS finishing,
           factory_response IS NOT NULL AS has_response
    FROM factory_quote_requests
    WHERE manychat_sub_id LIKE '972522839603%'
    ORDER BY created_at
  `) as Array<Record<string, unknown>>;
  console.log(`=== DB rows for אבי: ${dbRows.length} ===`);
  for (const r of dbRows) {
    console.log(
      `  id=${r.id} | qNo=${r.quotation_no} | status=${r.factory_status} | feishuRow=${r.feishu_row_index ?? "—"} | created=${r.created_at} | qty=${r.qty} | desc=${r.description}`
    );
  }

  console.log("\n=== Feishu rows matching these quote numbers ===");
  const feishuRows = await readAllRows(500);
  const dbQNos = new Set(dbRows.map((r) => (r.quotation_no as string) || ""));
  for (let i = 0; i < feishuRows.length; i++) {
    const cells = feishuRows[i];
    const rawQNo = String(cells[1] ?? "").trim();
    if (!/^[A-Z0-9]{4,}(-[A-Z0-9]+)?$/i.test(rawQNo)) continue;
    const qNo = baseQuoteNo(rawQNo);
    const customer = String(cells[0] ?? "").trim();
    if (customer === "אבי" || dbQNos.has(qNo)) {
      console.log(`  feishuRow=${i + 1} | qNo=${rawQNo} (base=${qNo}) | customer="${customer}" | inDb=${dbQNos.has(qNo)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
