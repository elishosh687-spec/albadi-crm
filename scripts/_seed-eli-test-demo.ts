/**
 * Seed a DEMO deal for Eli — "אלי — בדיקת מערכת" — so he can see the whole
 * draft↔factory↔closed flow end-to-end with fictitious but realistic numbers.
 * Requested by Eli 2026-07-22 ("תכניס אותי בתור לקוח, תיצור הצעות פיקטיביות").
 *
 * Creates:
 *  - lead  test:eli-demo   (WON, no phone/JID → nothing can be sent to it)
 *  - draft quote  TESTD1   (priced estimate, NOT sent → shows in unsent panel)
 *  - finalized    TESTF1   (factory numbers + draftEstimate snapshot + WON)
 *
 * Story: 5,000 bags 35/10/25. Estimate ₪4.00/unit, 3.00 CBM. Factory came back
 * ₪4.24/unit (+6%), 3.40 CBM (+13%) → the comparison strip + accuracy stats
 * have a real pair to show.
 *
 * Run:     npx tsx scripts/_seed-eli-test-demo.ts --go
 * Cleanup: npx tsx scripts/_seed-eli-test-demo.ts --cleanup
 */
import { neon } from "@neondatabase/serverless";

const SID = "test:eli-demo";
const DRAFT_ID = "fq_testdemo_draft1";
const FINAL_ID = "fq_testdemo_final1";

const spec = {
  description: "Albadi non-woven bag (TEST)",
  material: "80 gsm non-woven",
  widthCm: 25,
  heightCm: 35,
  depthCm: 10,
  quantity: 5000,
  printing: "2 color(s)",
  finishing: "Handles / not laminated",
  productName: "שקית אלבד ממותגת — בדיקת מערכת",
};

// The self-calculated estimate (what the מחשבון המשוער would have said).
const estimate = {
  quantity: 5000, currency: "ILS",
  unitCost: 1.9, unitShipping: 0.66, unitProfit: 1.44, unitSellingPrice: 4.0,
  totalCost: 9500, totalShipping: 3300, totalProfit: 7200, totalSellingPrice: 20000,
  totalCartons: 50, totalWeightKg: 900, totalCbm: 3.0,
  profitMarginPct: 36, shippingOptionId: "s2", shippingOptionName: "ים (סטנדרט)",
  commissionPct: 10,
  moldsTotalCny: 0, moldsPerUnitCny: 0, moldsTotalCostIls: 0,
  moldsTotalSellingPriceIls: 0, moldsTotalProfitIls: 0,
};

// The factory's real quote — a bit pricier and bulkier than the estimate.
const factoryPricing = {
  quantity: 5000, currency: "ILS",
  unitCost: 2.12, unitShipping: 0.75, unitProfit: 1.37, unitSellingPrice: 4.24,
  totalCost: 10600, totalShipping: 3740, totalProfit: 6860, totalSellingPrice: 21200,
  totalCartons: 50, totalWeightKg: 940, totalCbm: 3.4,
  profitMarginPct: 32, shippingOptionId: "s2", shippingOptionName: "ים (סטנדרט)",
  commissionPct: 10,
  moldsTotalCny: 0, moldsPerUnitCny: 0, moldsTotalCostIls: 0,
  moldsTotalSellingPriceIls: 0, moldsTotalProfitIls: 0,
};

const factoryResponse = {
  unitCostCny: 1.65, cartonQty: 100,
  cartonLengthCm: 68, cartonWidthCm: 40, cartonHeightCm: 25,
  cartonCbm: 0.068, weightKg: 18.8, supplier: "Mandy (TEST)",
  notes: "בדיקת מערכת — נתונים פיקטיביים",
};

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const mode = process.argv.includes("--cleanup")
    ? "cleanup"
    : process.argv.includes("--go")
      ? "go"
      : "dry";

  if (mode === "cleanup") {
    const a = await sql`DELETE FROM factory_quote_requests WHERE id IN (${DRAFT_ID}, ${FINAL_ID}) RETURNING id`;
    const b = await sql`DELETE FROM leads WHERE manychat_sub_id = ${SID} RETURNING manychat_sub_id`;
    console.log("cleaned:", a.map((r) => r.id), b.map((r) => r.manychat_sub_id));
    return;
  }
  if (mode === "dry") {
    console.log("DRY. Use --go to seed, --cleanup to remove."); return;
  }

  await sql`
    INSERT INTO leads (manychat_sub_id, name, active, source, pipeline_stage)
    VALUES (${SID}, ${"אלי — בדיקת מערכת"}, true, 'manual', 'WON')
    ON CONFLICT (manychat_sub_id) DO UPDATE SET name = EXCLUDED.name, pipeline_stage = 'WON'`;

  await sql`
    INSERT INTO factory_quote_requests (id, manychat_sub_id, quotation_no, product_spec, factory_status, final_pricing, created_at, updated_at)
    VALUES (${DRAFT_ID}, ${SID}, 'TESTD1', ${JSON.stringify(spec)}::jsonb, 'draft', ${JSON.stringify(estimate)}::jsonb,
            now() - interval '3 days', now() - interval '3 days')
    ON CONFLICT (id) DO UPDATE SET final_pricing = EXCLUDED.final_pricing, factory_status = 'draft', sent_to_customer_at = NULL`;

  await sql`
    INSERT INTO factory_quote_requests (id, manychat_sub_id, quotation_no, product_spec, factory_status,
                                        factory_response, final_pricing, draft_estimate, sent_to_customer_at, created_at, updated_at)
    VALUES (${FINAL_ID}, ${SID}, 'TESTF1', ${JSON.stringify(spec)}::jsonb, 'finalized',
            ${JSON.stringify(factoryResponse)}::jsonb, ${JSON.stringify(factoryPricing)}::jsonb,
            ${JSON.stringify(estimate)}::jsonb, now() - interval '1 day', now() - interval '2 days', now() - interval '1 day')
    ON CONFLICT (id) DO UPDATE SET final_pricing = EXCLUDED.final_pricing, draft_estimate = EXCLUDED.draft_estimate,
                                   factory_status = 'finalized', actual_costs = NULL`;

  console.log("seeded:", SID, DRAFT_ID, FINAL_ID);
}

main().catch((e) => { console.error(e); process.exit(1); });
