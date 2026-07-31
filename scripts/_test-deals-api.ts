/**
 * Scratch: exercise GET /api/widget/deals against the live DB by importing the
 * route handler directly (no dev server needed).
 *
 *   DATABASE_URL="$(~/.local/node/bin/neonctl connection-string --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)" npx tsx scripts/_test-deals-api.ts
 */
import { NextRequest } from "next/server";
import { GET } from "@/app/api/widget/deals/route";

async function call(qs: string) {
  const req = new NextRequest(`https://albadi-crm.vercel.app/api/widget/deals${qs}`);
  const res = await GET(req);
  return { status: res.status, body: await res.json() };
}

async function main() {
  const { status, body } = await call("?limit=3");
  console.log("status", status, "| count", body.count, "of", body.total_closed_deals);
  for (const d of body.deals ?? []) {
    console.log("\n=== deal", d.deal_id.slice(0, 8), d.quotation_no ?? "(no q#)", d.is_combined ? "[משולבת]" : "");
    console.log("  customer:", JSON.stringify(d.customer));
    console.log("  מסמך הלקוח:", d.customer_pdf_url);
    console.log("  lines:", d.line_items.length);
    for (const l of d.line_items) {
      console.log(
        `    - ${l.name} | qty ${l.quantity} × ₪${l.unit_price_ex_vat} = ₪${l.line_total_ex_vat}` +
          ` | colors ${l.spec.logo_colors} handles ${l.spec.has_handles} lam ${l.spec.has_lamination}` +
          ` | molds ₪${l.one_time_molds_ex_vat}`
      );
    }
    console.log(
      `  subtotal ₪${d.subtotal_ex_vat} + VAT ${d.vat_pct}% ₪${d.vat_amount} = ₪${d.total_inc_vat}`
    );
    console.log("  payment_terms:", JSON.stringify(d.payment_terms));
    // The invariant an invoicing bot depends on: lines must sum to the subtotal.
    const sum = Math.round(d.line_items.reduce((s: number, l: any) => s + l.line_total_ex_vat, 0) * 100) / 100;
    const drift = Math.round((sum - d.subtotal_ex_vat) * 100) / 100;
    console.log(`  Σ lines ₪${sum} vs subtotal ₪${d.subtotal_ex_vat} → drift ₪${drift}${drift === 0 ? " ✓" : "  ⚠️"}`);
    if (d.payment_terms) {
      const inst = Math.round(d.payment_terms.installments.reduce((s: number, i: any) => s + i.amount_inc_vat, 0) * 100) / 100;
      console.log(`  Σ installments ₪${inst} vs total ₪${d.total_inc_vat}${inst === d.total_inc_vat ? " ✓" : "  ⚠️"}`);
    }
  }

  // Filters
  const first = body.deals?.[0];
  if (first) {
    const bySid = await call(`?sid=${encodeURIComponent(first.customer.sid)}`);
    console.log(`\n?sid=${first.customer.sid} → ${bySid.body.count} deal(s)`);
    const byId = await call(`?id=${first.deal_id}`);
    console.log(`?id=<deal> → ${byId.body.count} deal(s)`);
    const name = (first.customer.name ?? "").slice(0, 4);
    if (name) {
      const byQ = await call(`?q=${encodeURIComponent(name)}`);
      console.log(`?q=${name} → ${byQ.body.count} deal(s)`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
