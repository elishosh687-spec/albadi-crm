/**
 * One-off DB repair: product_spec.finishing for 15JQUZLK got corrupted to
 * "[object Object],[object Object]" (Feishu rich-text JSON coerced via
 * String()). Restore the original string from the Feishu sheet.
 *
 * Original (from Feishu col I, see _audit-two-quotes-feishu.ts output):
 *   "With handles / laminated"
 *
 * But the user-confirmed value (from the earlier clean spec snapshot):
 *   "With handles / Not laminated"
 *
 * We use the confirmed value — it matches the product, factory bill of materials,
 * and the customer brief ("ללא למינציה" in the user's UI).
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows = (await sql`
    SELECT id, product_spec FROM factory_quote_requests
    WHERE upper(quotation_no) = '15JQUZLK'
  `) as Array<{ id: string; product_spec: Record<string, unknown> }>;
  if (rows.length === 0) {
    console.log("not found");
    return;
  }
  const row = rows[0];
  const cur = row.product_spec.finishing;
  console.log("current finishing:", JSON.stringify(cur));
  if (typeof cur === "string" && !cur.includes("[object Object]")) {
    console.log("finishing already looks clean — nothing to do.");
    return;
  }
  const fixed = "With handles / Not laminated";
  const newSpec = { ...row.product_spec, finishing: fixed };
  // Also clear pdf_url so the next finalize re-renders with the new pricing.
  await sql`
    UPDATE factory_quote_requests
    SET product_spec = ${JSON.stringify(newSpec)}::jsonb,
        pdf_url = NULL,
        updated_at = NOW()
    WHERE id = ${row.id}
  `;
  console.log(`updated id=${row.id} finishing → "${fixed}", pdf_url cleared.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
