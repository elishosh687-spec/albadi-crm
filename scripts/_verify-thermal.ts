/**
 * Verify "שומר קור" (2026-09-10) against the live config.
 *
 * The contract: +10% on the BAG cost only. Shipping, the plate fee and the molds
 * must be identical to the agora with and without it, in every engine, and the
 * estimator must apply it exactly once (not ×1.21).
 */
import "dotenv/config";
import { calculateQuoteByCodes, resolveQuantityTier } from "../lib/factory/calculator";
import { estimateQuoteForSpec } from "../lib/factory/server/estimate-quote";
import { priceFactoryQuote } from "../lib/factory/pricing";
import { getFactoryConfig } from "../lib/factory/config";
import { humanizeFinishing } from "../lib/factory/qstate-decode";
import { withThermalToken, hasThermal, looksAlreadyThermal } from "../lib/factory/thermal";

let failed = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}${detail ? `  (${detail})` : ""}`);
}
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

async function main() {
  const cfg = await getFactoryConfig({ fresh: true });

  console.log("\n① catalog engine — p2 30×10×30 · 5,000 · 2 colours · laminated (plate fee in play) · sea · molds");
  const tier = resolveQuantityTier(5000);
  const base = { productId: "p2", quantityTierId: tier.id, hasHandles: true, logoColors: 2,
    hasLamination: true, shippingOptionId: "s2", moldsCostCny: 2000 };
  const off = (await calculateQuoteByCodes({ ...base }))!.result;
  const on = (await calculateQuoteByCodes({ ...base, thermalLining: true }))!.result;
  const plateOff = off.plateFeeCny, bagOff = off.unitProductionCny - plateOff;
  // unitProductionCny / plateFeeCny come back ROUNDED to 2dp, so compare the
  // unrounded add-on (3dp) for exactness and the rounded bag within rounding.
  check("bag cost × 1.10 (within 2dp rounding)", near(on.unitProductionCny - on.plateFeeCny, bagOff * 1.1, 0.006),
    `¥${bagOff.toFixed(2)} → ¥${(on.unitProductionCny - on.plateFeeCny).toFixed(2)}`);
  check("plate fee unchanged", near(on.plateFeeCny, plateOff), `¥${plateOff}`);
  check("shipping unchanged", near(on.shippingPerUnitUsd, off.shippingPerUnitUsd));
  check("molds unchanged", near(on.moldsTotalSellingPriceIls, off.moldsTotalSellingPriceIls));
  check("thermalAddonCny reported", on.thermalLining && near(on.thermalAddonCny, bagOff * 0.1, 1e-3),
    `¥${on.thermalAddonCny}`);
  check("customer price rises", on.sellingPricePerUnitIls > off.sellingPricePerUnitIls,
    `₪${off.sellingPricePerUnitIls} → ₪${on.sellingPricePerUnitIls}`);

  console.log("\n② factory-quote engine — ¥1.27 · 5,000 · real carton · plates ¥530×2 · molds");
  const fq = { factoryUnitCostCny: 1.27, quantity: 5000, shippingOptionId: "s2",
    cartonSpec: { qty: 200, weightKg: 17, lengthCm: 48, widthCm: 41, heightCm: 45 },
    platePerColorCny: 530, logoColors: 2, moldsCostCny: 1000 };
  const a = priceFactoryQuote(fq, cfg), b = priceFactoryQuote({ ...fq, thermalLining: true }, cfg);
  check("unit cost × 1.10 exactly", near(b.unitCost, a.unitCost * 1.1, 0.011), `₪${a.unitCost} → ₪${b.unitCost}`);
  check("shipping unchanged", near(b.totalShipping, a.totalShipping));
  check("plate fee unchanged", near(b.plateFeeTotalCostIls ?? 0, a.plateFeeTotalCostIls ?? 0));
  check("molds unchanged", near(b.moldsTotalSellingPriceIls, a.moldsTotalSellingPriceIls));
  check("off → no thermal fields", a.thermalLining === undefined && a.thermalAddonCny === undefined);

  console.log("\n③ estimator — 35×10×40 · 5,000 · applied ONCE (not ×1.21)");
  const spec = { widthCm: 35, heightCm: 40, depthCm: 10, quantity: 5000, hasHandles: true,
    hasLamination: false, logoColors: 1 };
  const e0 = await estimateQuoteForSpec({ spec, shippingOptionId: "s2" });
  const e1 = await estimateQuoteForSpec({ spec, shippingOptionId: "s2", thermalLining: true });
  const factoryCny = e0.estimate.factoryUnitCostCny!;
  // Exact: the add-on is 10% of the estimator's own cost — not 21% (×1.1²).
  check("add-on = 10% of the estimator cost, once", near(e1.result!.thermalAddonCny, factoryCny * 0.1, 0.0006),
    `¥${e1.result!.thermalAddonCny} vs ¥${(factoryCny * 0.1).toFixed(3)}`);
  const ratio = e1.result!.unitProductionCny / e0.result!.unitProductionCny;
  check("production ratio ≈ 1.10, not 1.21", ratio > 1.09 && ratio < 1.11, `×${ratio.toFixed(4)} (2dp-rounded fields)`);
  check("estimator's own factory cost untouched", near(e0.estimate.factoryUnitCostCny!, e1.estimate.factoryUnitCostCny!));

  console.log("\n④ the finishing string");
  const f = withThermalToken("With handles / Laminated", true);
  check("token appended", f === "With handles / Laminated / Thermal lining", f);
  check("idempotent", withThermalToken(f, true) === f);
  check("removable", withThermalToken(f, false) === "With handles / Laminated");
  check("detected", hasThermal(f) && !hasThermal("With handles / Laminated"));
  check("PDF keeps it", humanizeFinishing(f) === "עם ידיות, עם למינציה, שומר קור", humanizeFinishing(f));
  check("factory foil quote flagged", looksAlreadyThermal("铝箔平口保温袋"));
  check("our own token alone NOT flagged", !looksAlreadyThermal(withThermalToken(f, false), "80g non-woven"));

  console.log(failed ? `\n❌ ${failed} check(s) failed` : "\n✅ all checks passed");
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
