/**
 * Scan the factory's pricing for INTERNAL inconsistencies — SEPARATED by structure.
 * 2D (depth<=2) and 3D (depth>2) are NEVER compared to each other (different formulas).
 * For each structure: base-price contradictions + shipping/packing contradictions.
 * Quantity 3000+ only.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";
import { bagAreaCm2, colorsFromText } from "@/lib/factory/server/estimator-fit";
import type { FactoryProductSpec, FactoryResponse } from "@/lib/factory/types";

const parseHandles = (f: string) => /with handle|handles\b|ידיות/i.test(f) && !/no handle|non handle|not.*handle|ללא/i.test(f);
const parseLam = (f: string) => /laminat/i.test(f) && !/not laminat|non laminat/i.test(f);
const is80 = (m: string) => /80\s*(g|克|gsm)/i.test(m || "") && !/kraft|牛皮|card|食品|food|140|110|250/i.test(m || "");
const r = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const TIERS = ["3000", "5000", "10000"];

interface Cat { id: string; dim: string; h: number; d: number; w: number; area: number; p: any }
interface Q { qno: string; h: number; w: number; d: number; qty: number; handles: boolean; lam: boolean; colors: number; price: number; cbmU: number; cartonQty: number; area: number }

// ── catalog base-price contradictions within one structure ──
function catalogBasePrice(cats: Cat[]) {
  // per-product self-contradictions
  for (const c of cats) {
    const p = c.p;
    for (const [vn, v] of [["עם ידית", p.withHandles], ["בלי ידית", p.withoutHandles]] as const) {
      for (const [wn, pr] of [["רגיל", v.prices], ["למינציה", v.laminationPrices]] as const) {
        if (!pr) continue;
        for (let i = 0; i < TIERS.length - 1; i++) { const a = pr[TIERS[i]], b = pr[TIERS[i + 1]]; if (a != null && b != null && b > a) console.log(`   • ${c.id} ${c.dim} ${vn} ${wn}: כמות ${TIERS[i]} = ¥${a} · כמות ${TIERS[i + 1]} = ¥${b}  (יותר כמות, יקר יותר)`); }
      }
      if (v.laminationPrices) for (const t of TIERS) { const base = v.prices[t], lam = v.laminationPrices[t]; if (base != null && lam != null && lam <= base) console.log(`   • ${c.id} ${c.dim} ${vn} כמות ${t}: רגיל ¥${base} · למינציה ¥${lam}  (למינציה לא יקרה יותר)`); }
    }
    for (const t of TIERS) { const wh = p.withHandles.prices[t], nh = p.withoutHandles.prices[t]; if (wh != null && nh != null && wh <= nh) console.log(`   • ${c.id} ${c.dim} כמות ${t}: עם-ידית ¥${wh} · בלי-ידית ¥${nh}  (ידית לא יקרה יותר)`); }
  }
  // cross-bag: bigger area cheaper (same structure, same qty, same variant)
  for (const t of TIERS) for (const [vn, key] of [["עם ידית", "withHandles"], ["בלי ידית", "withoutHandles"]] as const) {
    const list = cats.map((c) => ({ c, price: c.p[key].prices[t] as number })).filter((x) => x.price != null).sort((a, b) => a.c.area - b.c.area);
    for (let i = 0; i < list.length - 1; i++) if (list[i + 1].price < list[i].price) console.log(`   • כמות ${t} ${vn}: ${list[i].c.dim} (שטח ${r(list[i].c.area, 0)}) ¥${list[i].price}  ·  ${list[i + 1].c.dim} (שטח ${r(list[i + 1].c.area, 0)}) ¥${list[i + 1].price}  (גדולה יותר אך זולה)`);
  }
}

// ── real-quote contradictions within one structure ──
function realBasePrice(qs: Q[]) {
  const groups: Record<string, Q[]> = {};
  for (const q of qs) { const k = `${q.h}x${q.w}x${q.d}|${q.qty}|h${q.handles ? 1 : 0}|l${q.lam ? 1 : 0}|c${q.colors}`; (groups[k] ??= []).push(q); }
  for (const g of Object.values(groups)) { const prices = [...new Set(g.map((x) => x.price))]; if (prices.length > 1) console.log(`   • ${g[0].h}×${g[0].w}${g[0].d ? `×D${g[0].d}` : ""} q${g[0].qty} ${g[0].handles ? "+ידית" : "בלי"} ${g[0].lam ? "lam" : "רגיל"} c${g[0].colors}: ${g.map((x) => `¥${x.price} (${x.qno})`).join("  ·  ")}`); }
}
function realShipping(qs: Q[]) {
  for (const q of qs.filter((x) => x.cbmU > 0)) { const T = (q.cbmU / q.area) * 1e7; if (T < 0.4 || T > 1.6) console.log(`   • ${q.qno} ${q.h}×${q.w}${q.d ? `×D${q.d}` : ""} q${q.qty}: ${q.cartonQty}/קרטון · עובי משתמע ${r(T, 2)} מ״מ`); }
  const seen = new Set<string>();
  for (let i = 0; i < qs.length; i++) for (let j = i + 1; j < qs.length; j++) {
    const a = qs[i], b = qs[j]; if (a.cartonQty === 0 || b.cartonQty === 0) continue; if (Math.abs(a.area - b.area) / a.area > 0.1) continue; if (a.lam !== b.lam) continue;
    const ratio = Math.max(a.cartonQty, b.cartonQty) / Math.min(a.cartonQty, b.cartonQty); const key = [a.qno, b.qno].sort().join("|");
    if (ratio < 1.5 || seen.has(key)) continue; seen.add(key);
    console.log(`   • ${a.h}×${a.w}${a.d ? `×D${a.d}` : ""} (${a.qno}) ${a.cartonQty}/קרטון  ·  ${b.h}×${b.w}${b.d ? `×D${b.d}` : ""} (${b.qno}) ${b.cartonQty}/קרטון  (שטח דומה, אריזה שונה ×${r(ratio, 1)})`);
  }
}

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const cats: Cat[] = DEFAULT_CONFIG.products.map((p) => { const m = p.dimensions.replace(/×/g, "*").match(/H(\d+)(?:\*D(\d+))?\*W(\d+)/i)!; const h = +m[1], d = m[2] ? +m[2] : 0, w = +m[3]; return { id: p.id, dim: p.dimensions, h, d, w, area: bagAreaCm2(h, d, w), p }; });
  const rows: any[] = await sql`SELECT quotation_no, product_spec as ps, factory_response as fr FROM factory_quote_requests`;
  const qs: Q[] = [];
  for (const row of rows) {
    const ps = (row.ps ?? {}) as FactoryProductSpec, fr = (row.fr ?? {}) as FactoryResponse;
    const h = ps.heightCm ?? 0, w = ps.widthCm ?? 0, d = ps.depthCm ?? 0, qty = ps.quantity ?? 0;
    if (!(h > 0 && w > 0 && (fr.unitCostCny ?? 0) > 0) || qty < 3000 || !is80((ps.material ?? "").toString())) continue;
    const cq = fr.cartonQty ?? 0, cbm = fr.cartonCbm ?? 0;
    qs.push({ qno: (row.quotation_no || "?").toString(), h, w, d, qty, handles: parseHandles((ps.finishing ?? "").toString()), lam: parseLam((ps.finishing ?? "").toString()), colors: colorsFromText((ps.printing ?? "1").toString()), price: fr.unitCostCny, cbmU: cq > 0 ? cbm / cq : 0, cartonQty: cq, area: bagAreaCm2(h, d, w) });
  }

  for (const [label, is3D] of [["תלת-מימד (3D)", true], ["דו-מימד (2D)", false]] as const) {
    const cat3 = cats.filter((c) => (c.d > 2) === is3D);
    const q3 = qs.filter((q) => (q.d > 2) === is3D);
    console.log(`\n\n████████ ${label} ████████`);
    console.log(`\n──── מחיר בסיס ────`);
    console.log(`\n [מהמחירון]`); catalogBasePrice(cat3);
    console.log(`\n [מהצעות אמת]`); realBasePrice(q3);
    console.log(`\n──── שילוח / אריזה ────`);
    console.log(`\n [מהצעות אמת]`); realShipping(q3);
  }
  console.log(`\n\n(נסרקו ${qs.length} הצעות אמת 80g בכמות 3000+)`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
