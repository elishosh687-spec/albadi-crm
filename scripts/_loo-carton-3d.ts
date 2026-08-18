/**
 * Leave-one-out test of the CARTON (shipping) model on 3D bags.
 * For each 3D quote: remove it (and its group) from the fitting pool, compute the
 * packing thickness T from the REST, predict its CBM/unit, compare to actual.
 * Proves whether "the standard bags are accurate" is real generalization or just
 * memorization.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { bagAreaCm2, catalogCartonPts, impliedTmm, isGussetedNormal } from "@/lib/factory/server/estimator-fit";
import type { FactoryProductSpec, FactoryResponse } from "@/lib/factory/types";

const is80 = (m: string) => /80\s*(g|克|gsm)/i.test(m || "") && !/kraft|牛皮|card|食品|food|140|110|250/i.test(m || "");
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const rows: any[] = await sql`SELECT quotation_no, product_spec as ps, factory_response as fr FROM factory_quote_requests`;
  // pool = catalog carton points (clean, no group) + DB 3D 80g carton points
  const cat = catalogCartonPts().map((p) => ({ ...p, group: `cat:${p.area}:${p.depth}` }));
  const db: { area: number; depth: number; height: number; cbmPerUnit: number; group: string; dim: string; qty: number; cc: number; lam: boolean }[] = [];
  for (const r of rows) {
    const ps = (r.ps ?? {}) as FactoryProductSpec, fr = (r.fr ?? {}) as FactoryResponse;
    const h = ps.heightCm ?? 0, w = ps.widthCm ?? 0, d = ps.depthCm ?? 0;
    if (d <= 2 || !(h > 0 && w > 0) || !is80((ps.material ?? "").toString()) || !(fr.cartonQty && fr.cartonCbm) || (ps.quantity ?? 0) < 3000) continue;
    const area = bagAreaCm2(h, d, w);
    db.push({ area, depth: d, height: h, cbmPerUnit: fr.cartonCbm / fr.cartonQty, group: (r.quotation_no || "?").toString(), dim: `${h}×${w}×D${d}`, qty: ps.quantity ?? 0, cc: fr.cartonQty, lam: /laminat/i.test((ps.finishing ?? "").toString()) && !/not|non/i.test((ps.finishing ?? "").toString()) });
  }
  const poolAll = [...cat.map((p) => ({ area: p.area, depth: p.depth, height: (p as any).height ?? 20, cbmPerUnit: p.cbmPerUnit, group: p.group })), ...db];

  const errs: number[] = [], errStd: number[] = [], errOut: number[] = [];
  console.log("\n═══ Leave-One-Out על מודל האריזה (3D) — כל שקית נחזית בלי עצמה ═══\n");
  console.log(" שקית          | שטח  | אמת cbm/יח׳ | חזוי (LOO) | טעות | קבוצה");
  for (const t of db.sort((a, b) => a.area - b.area)) {
    // fit T from the rest (gusseted-normal only), excluding this bag's group
    const others = poolAll.filter((p) => p.group !== t.group).filter((p) => isGussetedNormal(p)).map((p) => impliedTmm(p as any));
    if (!others.length) continue;
    const Tloo = median(others);
    const pred = Tloo * t.area * 1e-7;
    const err = (pred - t.cbmPerUnit) / t.cbmPerUnit * 100;
    errs.push(err);
    const isOutlier = t.area < 2600;
    (isOutlier ? errOut : errStd).push(err);
    console.log(`  ${t.dim.padEnd(13)}| ${String(Math.round(t.area)).padStart(4)} | ${t.cbmPerUnit.toFixed(5)}   | ${pred.toFixed(5)}  | ${(err >= 0 ? "+" : "") + err.toFixed(0)}%${Math.abs(err) > 15 ? " ❌" : " ✅"} | ${t.group}`);
  }
  const mad = (a: number[]) => median(a.map(Math.abs));
  console.log(`\n── סיכום ──`);
  console.log(`  כל ה-3D (${errs.length}): טעות |חציון| ${mad(errs).toFixed(1)}%`);
  console.log(`  שקיות רגילות (שטח≥2600, ${errStd.length}): טעות |חציון| ${mad(errStd).toFixed(1)}%  ← האם מכליל?`);
  console.log(`  שקיות קטנות  (שטח<2600, ${errOut.length}): טעות |חציון| ${mad(errOut).toFixed(1)}%  ← החריגות`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
