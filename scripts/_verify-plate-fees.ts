import { DEFAULT_CONFIG } from "../lib/factory/calculator/constants";

const cases = [
  { n: 1,  productId: "p1",  qtyId: "q1", handles: true,  lam: false, colors: 1, expected: 2340 },
  { n: 2,  productId: "p1",  qtyId: "q2", handles: false, lam: false, colors: 3, expected: 4000 },
  { n: 3,  productId: "p2",  qtyId: "q3", handles: true,  lam: false, colors: 2, expected: 7100 },
  { n: 4,  productId: "p2",  qtyId: "q2", handles: true,  lam: true,  colors: 2, expected: 4520 },
  { n: 5,  productId: "p3",  qtyId: "q0", handles: false, lam: true,  colors: 3, expected: 3590 },
  { n: 6,  productId: "p4",  qtyId: "q0", handles: true,  lam: false, colors: 1, expected: 2100 },
  { n: 7,  productId: "p9",  qtyId: "q1", handles: false, lam: false, colors: 3, expected: 4230 },
  { n: 8,  productId: "p10", qtyId: "q1", handles: true,  lam: true,  colors: 1, expected: 10060 },
  { n: 9,  productId: "p5",  qtyId: "q3", handles: false, lam: true,  colors: 3, expected: 6300 },
  { n: 10, productId: "p11", qtyId: "q2", handles: true,  lam: false, colors: 2, expected: 4150 },
  { n: 11, productId: "p13", qtyId: "q3", handles: false, lam: false, colors: 1, expected: 5600 },
  { n: 12, productId: "p14", qtyId: "q1", handles: true,  lam: true,  colors: 2, expected: 5190 },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const product = DEFAULT_CONFIG.products.find((p) => p.id === c.productId)!;
  const tier = DEFAULT_CONFIG.quantityTiers.find((t) => t.id === c.qtyId)!;
  const variant = c.handles ? product.withHandles : product.withoutHandles;
  const qty = tier.quantity;
  let totalCny: number;
  if (c.lam) {
    const base = variant.laminationPrices![String(qty)];
    totalCny = base * qty + (product.laminationColorPlateFee ?? 0) * c.colors;
  } else {
    const base = variant.prices[String(qty)];
    const addon = DEFAULT_CONFIG.colorAddons.find((a) => a.colors === c.colors)!.pricesByQuantity[String(qty)];
    totalCny = (base + addon) * qty;
  }
  totalCny = Math.round(totalCny);
  const ok = totalCny === c.expected;
  const tag = ok ? "OK  " : "FAIL";
  console.log(`case ${String(c.n).padStart(2)} (${c.productId}, q=${qty}, lam=${c.lam}, c=${c.colors}): got ${totalCny} expected ${c.expected} ${tag}`);
  if (ok) pass++; else fail++;
}
console.log(`\nsummary: ${pass}/${cases.length} pass, ${fail} fail`);
