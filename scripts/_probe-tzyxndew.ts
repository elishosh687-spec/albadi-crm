/**
 * Probe TZYXNDEW: why did it ship with 0 kg / no carton dims?
 * Compare DB factory_response, productSpec, final_pricing — and the live
 * Feishu row content for that quotationNo.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { findRowByQuotationNo, readRow, parseFactoryResponseRow, parseFactoryRequestRow } from "@/lib/feishu/sheets";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT id, manychat_sub_id, quotation_no, factory_status, feishu_row_index,
           created_at, updated_at, pdf_url,
           product_spec, factory_response, final_pricing
    FROM factory_quote_requests
    WHERE upper(quotation_no) = 'TZYXNDEW'
  `) as Array<Record<string, unknown>>;
  if (rows.length === 0) { console.log("not found"); return; }
  const r = rows[0];
  console.log("=== DB row ===");
  console.log("id:", r.id);
  console.log("status:", r.factory_status);
  console.log("feishu_row_index:", r.feishu_row_index);
  console.log("pdf_url:", r.pdf_url ? "(set)" : "(null)");
  console.log("created:", r.created_at);
  console.log("updated:", r.updated_at);
  console.log("\nproduct_spec:");
  console.log(JSON.stringify(r.product_spec, null, 2));
  console.log("\nfactory_response:");
  console.log(JSON.stringify(r.factory_response, null, 2));
  console.log("\nfinal_pricing:");
  console.log(JSON.stringify(r.final_pricing, null, 2));

  // Now check Feishu
  console.log("\n=== Feishu lookup ===");
  const live = await findRowByQuotationNo("TZYXNDEW");
  console.log("findRowByQuotationNo:", live);
  const idx = (live ?? r.feishu_row_index) as string | null;
  if (idx) {
    const cells = await readRow(idx);
    console.log(`\nRaw cells at row ${idx}:`);
    cells.forEach((c, i) => console.log(`  [${i}] ${typeof c === "string" ? JSON.stringify(c) : JSON.stringify(c)}`));
    console.log("\nparseFactoryRequestRow:");
    console.log(JSON.stringify(parseFactoryRequestRow(cells), null, 2));
    console.log("\nparseFactoryResponseRow:");
    console.log(JSON.stringify(parseFactoryResponseRow(cells), null, 2));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
