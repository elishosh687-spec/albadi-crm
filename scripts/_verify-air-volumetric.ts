/**
 * Verifies the air-freight chargeable-weight change in BOTH pricing engines:
 *   - lib/factory/pricing.ts        (priceFactoryQuote)
 *   - lib/factory/calculator/engine (calculateQuote)
 *
 * Air must bill on chargeable weight = max(actual kg, cbm × 167).
 *   • Bulky/light cargo (volume wins)  → air cost INCREASES vs old physical-only.
 *   • Dense/heavy cargo (weight wins)  → air cost UNCHANGED (regression guard).
 * Run: DATABASE_URL=... npx tsx scripts/_verify-air-volumetric.ts   (no DB needed)
 */
import { priceFactoryQuote } from "../lib/factory/pricing";
import type { FactoryPricingConfig } from "../lib/factory/types";
import { calculateQuote } from "../lib/factory/calculator/engine";
import type { AppConfig, QuoteFormData } from "../lib/factory/calculator/types";

const KG_PER_CBM = 167;
const USD_TO_ILS = 3.6;
const QTY = 100;

// Two carton specs, 10 units/carton → 10 cartons at qty 100.
// Bulky: 60×60×60 cm = 0.216 m³/carton, 5 kg  → volume dominates.
// Dense: 30×30×30 cm = 0.027 m³/carton, 25 kg → physical weight dominates.
const BULKY = { qty: 10, weightKg: 5, lengthCm: 60, widthCm: 60, heightCm: 60 };
const DENSE = { qty: 10, weightKg: 25, lengthCm: 30, widthCm: 30, heightCm: 30 };
const AIR = { thresholdKg: 100, rateBelowThreshold: 13, rateAboveThreshold: 8.5 };

function expectedAirPerUnitUsd(c: typeof BULKY): {
  oldUsd: number;
  newUsd: number;
} {
  const cartons = Math.ceil(QTY / c.qty);
  const actual = c.weightKg * cartons;
  const cbm = ((c.lengthCm * c.widthCm * c.heightCm) / 1_000_000) * cartons;
  const charge = Math.max(actual, cbm * KG_PER_CBM);
  const rNew = charge <= AIR.thresholdKg ? AIR.rateBelowThreshold : AIR.rateAboveThreshold;
  const rOld = actual <= AIR.thresholdKg ? AIR.rateBelowThreshold : AIR.rateAboveThreshold;
  return { oldUsd: (actual * rOld) / QTY, newUsd: (charge * rNew) / QTY };
}

// ---- engine (calculateQuote) minimal config ----
function appConfig(carton: typeof BULKY): AppConfig {
  const variant = { prices: { "100": 1.0 }, carton: {
    qty: carton.qty, weight: carton.weightKg,
    length: carton.lengthCm, width: carton.widthCm, height: carton.heightCm,
  } };
  return {
    products: [{
      id: "p1", dimensions: "30*40", description: "test",
      withHandles: variant, withoutHandles: variant, sortOrder: 0,
    }],
    colorAddons: [],
    quantityTiers: [{ id: "q0", quantity: 100, label: "100", sortOrder: 0 }],
    shippingOptions: [
      { id: "s-air", name: "Air", description: "", deliveryDays: 7, type: "air", enabled: true, airRates: AIR },
      { id: "s-sea", name: "Sea", description: "", deliveryDays: 60, type: "sea", enabled: true, seaRate: 500 },
    ],
    features: [],
    exchangeRates: { usdToIls: USD_TO_ILS, usdToCny: 7.2 },
    adminSettings: { globalProfitMargin: 30 },
  };
}
function enginePerUnitUsd(carton: typeof BULKY, shippingId: string): number {
  const fd: QuoteFormData = {
    productId: "p1", quantityTierId: "q0", quantityOverride: QTY,
    hasHandles: false, logoColors: 0, shippingOptionId: shippingId, selectedFeatureIds: [],
  };
  return calculateQuote(fd, appConfig(carton))!.shippingPerUnitUsd;
}

// ---- pricing (priceFactoryQuote) ----
function pricingPerUnitUsd(carton: typeof BULKY, shippingId: string): number {
  const cfg: FactoryPricingConfig = {
    shippingOptions: [
      { id: "s-air", name: "Air", type: "air", enabled: true, airRates: AIR },
      { id: "s-sea", name: "Sea", type: "sea", enabled: true, seaRate: 500 },
    ],
    usdToIls: USD_TO_ILS, usdToCny: 7.2, defaultProfitMargin: 30, currency: "ILS",
  };
  const r = priceFactoryQuote(
    { factoryUnitCostCny: 5, quantity: QTY, shippingOptionId: shippingId, cartonSpec: carton },
    cfg
  );
  return r.unitShipping / USD_TO_ILS; // ILS → USD
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.02;
let fail = 0;
function check(label: string, got: number, want: number) {
  const ok = near(got, want);
  if (!ok) fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}: got $${got.toFixed(4)}  want $${want.toFixed(4)}`);
}

for (const [name, c] of [["BULKY", BULKY], ["DENSE", DENSE]] as const) {
  const exp = expectedAirPerUnitUsd(c);
  console.log(`\n=== ${name} (air per-unit USD) — old $${exp.oldUsd.toFixed(4)} → new $${exp.newUsd.toFixed(4)} ===`);
  check(`pricing.ts  ${name}`, pricingPerUnitUsd(c, "s-air"), exp.newUsd);
  check(`engine.ts   ${name}`, enginePerUnitUsd(c, "s-air"), exp.newUsd);
  if (name === "BULKY" && !(exp.newUsd > exp.oldUsd + 0.01)) {
    fail++; console.log("❌ expected BULKY air to INCREASE vs old physical-only");
  } else if (name === "BULKY") {
    console.log(`✅ BULKY air increased (${(exp.newUsd / exp.oldUsd).toFixed(1)}× old)`);
  }
  if (name === "DENSE" && !near(exp.newUsd, exp.oldUsd)) {
    fail++; console.log("❌ expected DENSE air UNCHANGED vs old");
  } else if (name === "DENSE") {
    console.log("✅ DENSE air unchanged (regression guard)");
  }
}

// Sea must be untouched (priced per CBM).
console.log("\n=== SEA unchanged (priced per CBM, not weight) ===");
for (const [name, c] of [["BULKY", BULKY], ["DENSE", DENSE]] as const) {
  const cartons = Math.ceil(QTY / c.qty);
  const cbm = ((c.lengthCm * c.widthCm * c.heightCm) / 1_000_000) * cartons;
  const wantSea = (Math.max(cbm, 1) * 500) / QTY;
  check(`pricing.ts sea ${name}`, pricingPerUnitUsd(c, "s-sea"), wantSea);
  check(`engine.ts  sea ${name}`, enginePerUnitUsd(c, "s-sea"), wantSea);
}

console.log(fail === 0 ? "\n🎉 ALL CHECKS PASSED" : `\n💥 ${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
