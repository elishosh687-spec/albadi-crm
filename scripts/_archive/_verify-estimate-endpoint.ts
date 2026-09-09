/** Exercise the REAL /api/factory/estimate handler against the live DB. */
import { GET } from "@/app/api/factory/estimate/route";
import { NextRequest } from "next/server";

const cases = [
  { label: "Mandy lam 3c 5000 (real ¥1.08)", q: "heightCm=29&depthCm=25&widthCm=35&qty=5000&handles=true&lamination=true&colors=3&shipping=s2" },
  { label: "亚森 non-lam 2c 3000 (real ¥1.5)", q: "heightCm=45&depthCm=10&widthCm=50&qty=3000&handles=true&lamination=false&colors=2&shipping=s2" },
  { label: "tiny bag → refuse", q: "heightCm=15&depthCm=0&widthCm=45&qty=10000&handles=true&lamination=false&colors=2&shipping=s2" },
];

async function main() {
  for (const c of cases) {
    const res = await GET(new NextRequest(`http://localhost/api/factory/estimate?${c.q}`));
    const j = await res.json();
    const e = j.estimate;
    if (e?.ok) {
      console.log(`✓ ${c.label}\n   factory=${e.factoryName} conf=${e.confidence} unitCNY=¥${e.factoryUnitCostCny} plate=¥${e.plateFeeOneTimeCny}`);
      console.log(`   → customer: ₪${j.result?.sellingPricePerUnitIls}/unit  total ₪${j.result?.totalOrderPriceIls}  (margin ${j.result?.profitMargin}%, ${j.result?.shippingOption?.name})`);
      console.log(`   reasoning: ${(e.reasoning ?? []).join(" | ")}`);
    } else {
      console.log(`⊘ ${c.label}\n   REFUSED: ${e?.refused}`);
    }
  }
}
main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
