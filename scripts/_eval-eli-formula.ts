/**
 * Empirically test Eli's 3D power-law formula (2026-07-02) against real 3D
 * quotes, leave-one-group-out, and compare to our regression.
 *
 * price = base_price × (area/base_area)^0.054 × (qty/base_qty)^0.008
 *         + 0.059×Δcolors + 0.021×Δhandle + 0.025×Δlam
 * cbm/u = base_cbm  × (area/base_area)^0.594
 * base  = nearest 3D anchor (prefer same lam, handle, qty-tier; then nearest area)
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";
import { bagAreaCm2, colorsFromText } from "@/lib/factory/server/estimator-fit";
import type { FactoryProductSpec, FactoryResponse } from "@/lib/factory/types";

const parseHandles = (f: string) => /with handle|handles\b|ידיות/i.test(f) && !/no handle|non handle|not.*handle|ללא/i.test(f);
const parseLam = (f: string) => /laminat/i.test(f) && !/not laminat|non laminat/i.test(f);
const is80 = (m: string) => /80\s*(g|克|gsm)/i.test(m || "") && !/kraft|牛皮|card|食品|food|140|110|250/i.test(m || "");
const snapTier = (q: number) => { let t = 3000; for (const x of [3000, 5000, 10000]) if (x <= q) t = x; return t; };
const median = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Anchor { h: number; w: number; d: number; area: number; handles: boolean; lam: boolean; colors: number; qty: number; price: number; cbmU: number; group: string; }

// Eli's constants
const A_EXP = 0.054, Q_EXP = 0.008, C_ADD = 0.059, H_ADD = 0.021, L_ADD = 0.025, CBM_EXP = 0.594;

function pickBase(t: Anchor, pool: Anchor[]): Anchor | null {
  const cand = pool.filter((a) => a.group !== t.group && a.d > 2); // 3D only, leave-one-group-out
  if (!cand.length) return null;
  const tiers = [
    (a: Anchor) => a.lam === t.lam && a.handles === t.handles && snapTier(a.qty) === snapTier(t.qty),
    (a: Anchor) => a.lam === t.lam && snapTier(a.qty) === snapTier(t.qty),
    (a: Anchor) => a.lam === t.lam,
    () => true,
  ];
  for (const f of tiers) {
    const sub = cand.filter(f);
    if (sub.length) return sub.reduce((best, a) => (Math.abs(a.area - t.area) < Math.abs(best.area - t.area) ? a : best));
  }
  return null;
}

function predict(t: Anchor, base: Anchor) {
  const price = base.price * (t.area / base.area) ** A_EXP * (t.qty / base.qty) ** Q_EXP
    + C_ADD * (t.colors - base.colors) + H_ADD * ((t.handles ? 1 : 0) - (base.handles ? 1 : 0)) + L_ADD * ((t.lam ? 1 : 0) - (base.lam ? 1 : 0));
  const cbmU = base.cbmU * (t.area / base.area) ** CBM_EXP;
  return { price, cbmU };
}

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const pool: Anchor[] = [];
  // catalog base anchors (price + cbm/unit)
  for (const p of DEFAULT_CONFIG.products) {
    const m = p.dimensions.replace(/×/g, "*").match(/H(\d+)(?:\*D(\d+))?\*W(\d+)/i); if (!m) continue;
    const h = +m[1], d = m[2] ? +m[2] : 0, w = +m[3], area = bagAreaCm2(h, d, w);
    for (const [handles, v] of [[true, p.withHandles], [false, p.withoutHandles]] as const) {
      const cbmU = (v.carton.length * v.carton.width * v.carton.height / 1e6) / v.carton.qty;
      for (const qk of ["3000", "5000", "10000"]) {
        const qty = +qk;
        if (v.prices[qk] != null) pool.push({ h, w, d, area, handles, lam: false, colors: 1, qty, price: v.prices[qk], cbmU, group: `cat:${p.id}:${handles}:nl` });
        if (v.laminationPrices?.[qk] != null) pool.push({ h, w, d, area, handles, lam: true, colors: 1, qty, price: v.laminationPrices[qk]!, cbmU, group: `cat:${p.id}:${handles}:lam` });
      }
    }
  }
  // DB quote anchors + targets
  const rows: any[] = await sql`SELECT id, quotation_no, product_spec as ps, factory_response as fr FROM factory_quote_requests`;
  const targets: (Anchor & { tag: string })[] = [];
  for (const r of rows) {
    const ps = (r.ps ?? {}) as FactoryProductSpec, fr = (r.fr ?? {}) as FactoryResponse;
    const h = ps.heightCm ?? 0, w = ps.widthCm ?? 0, d = ps.depthCm ?? 0, qty = ps.quantity ?? 0;
    if (!(h > 0 && w > 0 && (fr.unitCostCny ?? 0) > 0 && (fr.cartonQty ?? 0) > 0 && (fr.cartonCbm ?? 0) > 0)) continue;
    if (!is80((ps.material ?? "").toString())) continue;
    const a: Anchor = { h, w, d, area: bagAreaCm2(h, d, w), handles: parseHandles((ps.finishing ?? "").toString()), lam: parseLam((ps.finishing ?? "").toString()), colors: colorsFromText((ps.printing ?? "1").toString()), qty, price: fr.unitCostCny, cbmU: fr.cartonCbm! / fr.cartonQty!, group: (r.quotation_no || r.id).toString() };
    pool.push(a);
    if (d > 2 && qty >= 3000 && qty <= 10000) targets.push({ ...a, tag: `${h}×${w}×D${d} q${qty} c${a.colors}${a.lam ? " lam" : ""}${a.handles ? " +ידית" : ""}` });
  }

  const priceErrs: number[] = [], cbmErrs: number[] = [];
  console.log("\n════ בדיקת נוסחת 3D של אלי — leave-one-out מול אמת ════\n");
  for (const t of targets) {
    const base = pickBase(t, pool);
    if (!base) { console.log(`  ${t.tag}: אין בסיס`); continue; }
    const p = predict(t, base);
    const dPrice = (p.price - t.price) / t.price * 100;
    const dCbm = (p.cbmU - t.cbmU) / t.cbmU * 100;
    priceErrs.push(dPrice); cbmErrs.push(dCbm);
    console.log(`  ${t.tag}`);
    console.log(`     בסיס: ${base.h}×${base.w}×D${base.d} q${base.qty}${base.lam ? " lam" : ""} (¥${base.price}, cbm/u ${base.cbmU.toFixed(5)})`);
    console.log(`     מחיר: אמת ¥${t.price} · נוסחה ¥${r2(p.price)} → Δ ${dPrice >= 0 ? "+" : ""}${dPrice.toFixed(0)}%   |   CBM/u: אמת ${t.cbmU.toFixed(5)} · נוסחה ${p.cbmU.toFixed(5)} → Δ ${dCbm >= 0 ? "+" : ""}${dCbm.toFixed(0)}%`);
  }
  const ap = priceErrs.map(Math.abs), ac = cbmErrs.map(Math.abs);
  console.log(`\n  ── סיכום (${priceErrs.length} תלת-מימד) ──`);
  console.log(`  מחיר מפעל: |Δ| חציון ${r2(median(ap))}% · ממוצע ${r2(mean(ap))}% · חתום חציון ${r2(median(priceErrs))}% · תת-הערכה>10% ${priceErrs.filter((x) => x < -10).length}`);
  console.log(`  CBM/יח׳:   |Δ| חציון ${r2(median(ac))}% · ממוצע ${r2(mean(ac))}% · חתום חציון ${r2(median(cbmErrs))}% · תת-הערכה>10% ${cbmErrs.filter((x) => x < -10).length}`);
  console.log(`\n  (להשוואה — הרגרסיה שלנו על אותו סט: מחיר |Δ| חציון ~7.9%, CBM/שילוח בעיקר ±10%)`);

  // ── PROOF of leave-one-out: predict WITH the quote in the pool vs WITHOUT it ──
  console.log("\n════ הוכחה: עם ההצעה בבריכה מול בלי (leave-one-out) ════");
  for (const t of targets.slice(0, 3)) {
    const nearestInclSelf = pool.filter((a) => a.d > 2).reduce((b, a) => (Math.abs(a.area - t.area) < Math.abs(b.area - t.area) ? a : b));
    const wo = pickBase(t, pool);
    const pW = predict(t, nearestInclSelf);
    console.log(`\n  ${t.tag} — אמת ¥${t.price}`);
    console.log(`     WITH (ההצעה בבריכה): בסיס ${nearestInclSelf.h}×${nearestInclSelf.w}×D${nearestInclSelf.d} q${nearestInclSelf.qty} → ¥${r2(pW.price)} (Δ ${r2((pW.price - t.price) / t.price * 100)}%)  ← מזהה את עצמו`);
    if (wo) console.log(`     WITHOUT (LOO אמיתי): בסיס ${wo.h}×${wo.w}×D${wo.d} q${wo.qty} → ¥${r2(predict(t, wo).price)} (Δ ${r2((predict(t, wo).price - t.price) / t.price * 100)}%)  ← המבחן ההוגן`);
  }

  // ── improved variant V2: median-of-K bases, same qty-tier, exclude flat/tray + out-of-range qty ──
  const pickK = (t: Anchor, K: number) => {
    const c = pool.filter((a) => a.group !== t.group && a.d > 2 && a.h >= 10 && a.qty >= 3000 && a.qty <= 10000 && snapTier(a.qty) === snapTier(t.qty));
    let sub = c.filter((a) => a.lam === t.lam && a.handles === t.handles);
    if (sub.length < K) sub = c.filter((a) => a.lam === t.lam);
    if (sub.length < 2) sub = c;
    return sub.sort((a, b) => Math.abs(a.area - t.area) - Math.abs(b.area - t.area)).slice(0, K);
  };
  const predV2 = (t: Anchor, bases: Anchor[]) => {
    const px = bases.map((b) => b.price * (t.area / b.area) ** A_EXP + C_ADD * (t.colors - b.colors) + H_ADD * ((t.handles ? 1 : 0) - (b.handles ? 1 : 0)) + L_ADD * ((t.lam ? 1 : 0) - (b.lam ? 1 : 0)));
    const cbPow = bases.map((b) => b.cbmU * (t.area / b.area) ** CBM_EXP); // his 0.594
    const cbLin = bases.map((b) => b.cbmU * (t.area / b.area)); // our linear area^1
    return { price: median(px), cbmPow: median(cbPow), cbLin: median(cbLin) };
  };
  const pe: number[] = [], cePow: number[] = [], ceLin: number[] = [];
  for (const t of targets) {
    const bases = pickK(t, 5); if (bases.length < 2) continue;
    const p = predV2(t, bases);
    pe.push((p.price - t.price) / t.price * 100);
    cePow.push((p.cbmPow - t.cbmU) / t.cbmU * 100);
    ceLin.push((p.cbLin - t.cbmU) / t.cbmU * 100);
  }
  console.log("\n════ גרסה משופרת V2 (חציון-של-5 בסיסים, אותו tier, בלי חריגים) ════");
  console.log(`  מחיר מפעל: |Δ| חציון ${r2(median(pe.map(Math.abs)))}% · ממוצע ${r2(mean(pe.map(Math.abs)))}% · תת-הערכה>10% ${pe.filter((x) => x < -10).length}   (V1 היה: חציון 8.1% ממוצע 17.6%)`);
  console.log(`  CBM (0.594 שלך): |Δ| חציון ${r2(median(cePow.map(Math.abs)))}% · ממוצע ${r2(mean(cePow.map(Math.abs)))}%`);
  console.log(`  CBM (לינארי שלנו): |Δ| חציון ${r2(median(ceLin.map(Math.abs)))}% · ממוצע ${r2(mean(ceLin.map(Math.abs)))}%`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
