/**
 * Sanity-check post-reparse: for each flagged quote, print what the pricing
 * engine will compute for factory cost + shipping. If any number is nonsensical
 * (millions of NIS, thousands of cartons), the reparse didn't fully land.
 */
import "dotenv/config";
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { inArray } from "drizzle-orm";
import type { FactoryResponse, FactoryProductSpec } from "@/lib/factory/types";

async function main() {
  const qs = ["P2WXR65R", "55HETX5D", "PANLUIB8", "KYLWS12A", "FW7BYGAO", "V5CLAI5C"];
  const rows = await db
    .select()
    .from(factoryQuoteRequests)
    .where(inArray(factoryQuoteRequests.quotationNo, qs));

  for (const r of rows) {
    const fr = r.factoryResponse as FactoryResponse | null;
    const ps = r.productSpec as FactoryProductSpec | null;
    if (!fr || !ps) continue;
    const qty = ps.quantity;
    const cartons = fr.cartonQty ? Math.ceil(qty / fr.cartonQty) : 0;
    const totalCbm = cartons * (fr.cartonCbm ?? 0);
    const totalKg = cartons * (fr.weightKg ?? 0);
    const factoryCostCny = fr.unitCostCny * qty;
    console.log(`\n${r.quotationNo}  (${ps.customerName ?? "—"})`);
    console.log(`  order qty: ${qty}`);
    console.log(
      `  unit ¥${fr.unitCostCny}  →  factory cost = ¥${factoryCostCny.toLocaleString()}`
    );
    console.log(
      `  ${fr.cartonQty ?? "?"} /carton  →  ${cartons} cartons`
    );
    console.log(
      `  ${fr.cartonCbm ?? "?"} m³/carton  →  ${totalCbm.toFixed(2)} m³ total`
    );
    console.log(
      `  ${fr.weightKg ?? "?"} kg/carton  →  ${totalKg.toFixed(1)} kg total`
    );
    // Rough sanity ranges
    const badFactory = factoryCostCny > 1_000_000 || factoryCostCny < 100;
    const badCbm = totalCbm > 100 || totalCbm < 0.01;
    const badKg = totalKg > 10_000;
    if (badFactory || badCbm || badKg) {
      console.log(
        `  ⚠️ SANITY:${badFactory ? " factory-cost" : ""}${badCbm ? " total-cbm" : ""}${badKg ? " total-kg" : ""}`
      );
    } else {
      console.log(`  ✓ all values in sane range`);
    }
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
