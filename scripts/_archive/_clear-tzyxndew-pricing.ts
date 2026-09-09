/**
 * Revert my erroneous write: the TZYXNDEW row is 'received' (freshly
 * re-imported from Feishu with complete carton data). A received row should
 * NOT carry final_pricing — that's set at finalize. My earlier repair script
 * wrote a final_pricing with null shipping / 0 mold because it read those from
 * the empty post-import snapshot. Clear it so the row is a clean 'received'
 * state; the boss finalizes via the UI (picks shipping + mold + margin) and
 * finalize.ts computes correct pricing (now also re-pulling fresh from Feishu).
 *
 * factory_response is left intact — it's correct (cartonQty 200, 45×35×45,
 * cbm 0.07, weight 9).
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const res = (await sql`
    UPDATE factory_quote_requests
    SET final_pricing = NULL, pdf_url = NULL, updated_at = NOW()
    WHERE upper(quotation_no) = 'TZYXNDEW' AND factory_status = 'received'
    RETURNING id, factory_status, (factory_response IS NOT NULL) AS has_response
  `) as Array<Record<string, unknown>>;
  console.log("Cleared final_pricing on:", JSON.stringify(res, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
