/**
 * For each of the 14 products × each quantity tier × handles variant,
 * compute totalCbm and the gap between proportional shipping ($500 * cbm)
 * vs minimum-1-CBM ($500 flat). Highlight rows where cbm < 1 — those are
 * where consolidation risk bites.
 */
import { DEFAULT_CONFIG } from "../lib/factory/calculator/constants";

const SEA_RATE = 500;
const QTYS = [1000, 3000, 5000, 10000];

function r2(n: number) { return Math.round(n * 100) / 100; }
function r3(n: number) { return Math.round(n * 1000) / 1000; }

interface Row {
  product: string;
  dims: string;
  qty: number;
  handles: string;
  cartons: number;
  cbm: number;
  prop: number;
  minCharge: number;
  gap: number;
}

const rows: Row[] = [];

for (const p of DEFAULT_CONFIG.products) {
  for (const variantName of ["noHandles", "handles"] as const) {
    const v = variantName === "handles" ? p.withHandles : p.withoutHandles;
    const cbmPerCarton = (v.carton.length * v.carton.width * v.carton.height) / 1_000_000;
    for (const qty of QTYS) {
      const cartons = Math.ceil(qty / v.carton.qty);
      const totalCbm = cartons * cbmPerCarton;
      const prop = totalCbm * SEA_RATE;
      const minCharge = Math.max(totalCbm, 1) * SEA_RATE;
      rows.push({
        product: p.id,
        dims: p.dimensions,
        qty,
        handles: variantName,
        cartons,
        cbm: r3(totalCbm),
        prop: r2(prop),
        minCharge: r2(minCharge),
        gap: r2(minCharge - prop),
      });
    }
  }
}

console.log("\n=== <1 CBM (consolidation risk — shipping alone = $500 floor) ===\n");
const under = rows.filter(r => r.cbm < 1);
console.log(
  `id   dims              qty    var          cartons  cbm    prop$  min$   gap$`,
);
console.log("-".repeat(80));
for (const r of under) {
  console.log(
    `${r.product.padEnd(4)} ${r.dims.padEnd(17)} ${String(r.qty).padStart(5)}  ${r.handles.padEnd(10)} ${String(r.cartons).padStart(7)}  ${String(r.cbm).padStart(5)}  ${String(r.prop).padStart(5)}  ${String(r.minCharge).padStart(5)}  ${String(r.gap).padStart(4)}`,
  );
}

console.log(`\n${under.length} / ${rows.length} combos are < 1 CBM (${Math.round(100 * under.length / rows.length)}%)\n`);

console.log("=== 1 CBM crossover per product (min qty that exits the risk zone) ===\n");
for (const p of DEFAULT_CONFIG.products) {
  for (const variantName of ["noHandles", "handles"] as const) {
    const v = variantName === "handles" ? p.withHandles : p.withoutHandles;
    const cbmPerCarton = (v.carton.length * v.carton.width * v.carton.height) / 1_000_000;
    // qty needed to reach >= 1 CBM
    const cartonsNeeded = Math.ceil(1 / cbmPerCarton);
    const qtyNeeded = cartonsNeeded * v.carton.qty;
    console.log(
      `${p.id.padEnd(4)} ${p.dimensions.padEnd(17)} ${variantName.padEnd(10)} cbm/carton=${r3(cbmPerCarton)}  need ${cartonsNeeded} cartons = ${qtyNeeded} יח׳`,
    );
  }
}
console.log("");
