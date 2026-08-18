/**
 * Held-out test for SHIPPING: does folding the green quotes' real carton data
 * improve CBM/unit prediction vs the quote-free catalog backbone?
 *  - BACKBONE (no green quotes): global catalog T (from constants.ts carton points).
 *  - FOLDED (leave-one-out): predict each quote's CBM with T = median implied-T of
 *    all OTHER green quotes. Each quote carries a REAL carton profile → a direct
 *    implied-T (no stripping). Honest: the held-out quote never sets its own T.
 * READ-ONLY.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { catalogCartonPts, fitCartonT, isGussetedNormal, impliedTmm, bagAreaCm2, normSupplier } from "@/lib/factory/server/estimator-fit";

const median = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const meanAbs = (a: number[]) => a.reduce((s, x) => s + Math.abs(x), 0) / a.length;
const meanSg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

async function main() {
  const sql = neon(process.env.DATABASE_URL!);

  // BACKBONE: global catalog T from constants.ts carton points (quote-free)
  const catBackbone = fitCartonT(catalogCartonPts());
  const T_CATALOG = catBackbone.tMmGusseted;
  console.log(`\nעמוד שדרה (קטלוג בלבד, ללא הצעות): T=${T_CATALOG} מ"מ  ·  n=${catBackbone.n} נקודות קטלוג`);

  // green quotes carton profiles
  const rows: any[] = await sql`SELECT product_spec as ps, factory_response as fr FROM factory_quote_requests`;
  const pts = rows.filter((r) => normSupplier(((r.fr ?? {}).supplier ?? "").toString()) === "Mandy")
    .map((r) => { const ps = r.ps ?? {}, fr = r.fr ?? {}; const h = ps.heightCm, d = ps.depthCm ?? 0, w = ps.widthCm; const area = bagAreaCm2(h, d, w); const cq = +fr.cartonQty, cc = +fr.cartonCbm; return { area, depth: d, height: h, cbmPerUnit: cq > 0 ? cc / cq : 0, qty: ps.quantity ?? 0 }; })
    .filter((p) => p.cbmPerUnit > 0 && p.qty <= 10000 && isGussetedNormal(p));

  console.log(`הצעות ירוקות עם נתוני אריזה תקפים (3D, בתחום): ${pts.length}\n`);
  const impliedTs = pts.map(impliedTmm);
  console.log(`  T מחציון ההצעות: ${median(impliedTs).toFixed(3)} מ"מ  (טווח ${Math.min(...impliedTs).toFixed(2)}–${Math.max(...impliedTs).toFixed(2)})`);

  // A) catalog backbone T   B) leave-one-out folded per-factory T
  const eA: number[] = [], eB: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const predA = T_CATALOG * p.area * 1e-7;
    const others = pts.filter((_, j) => j !== i).map(impliedTmm);
    const predB = median(others) * p.area * 1e-7;
    eA.push((predA - p.cbmPerUnit) / p.cbmPerUnit * 100);
    eB.push((predB - p.cbmPerUnit) / p.cbmPerUnit * 100);
  }
  console.log(`\n🟢 שילוח: חיזוי CBM ליח׳ · ${pts.length} הצעות · Leave-One-Out\n`);
  console.log("                       │ T קטלוג בלבד        │ T + הצעות (LOO)");
  console.log("  " + "─".repeat(60));
  console.log(`  שגיאה מוחלטת ממוצעת   │ ${meanAbs(eA).toFixed(2)}%            │ ${meanAbs(eB).toFixed(2)}%   ${meanAbs(eB) < meanAbs(eA) - 0.2 ? "✅ שיפר" : meanAbs(eB) > meanAbs(eA) + 0.2 ? "⚠️ הרע" : "≈"}`);
  console.log(`  הטיה ממוצעת (מגמה)    │ ${meanSg(eA).toFixed(2)}%            │ ${meanSg(eB).toFixed(2)}%   ${Math.abs(meanSg(eB)) < Math.abs(meanSg(eA)) - 0.2 ? "✅ פחות מוטה" : "≈"}`);
  console.log("\n  (הקטלוג הבודד לא יודע שהאריזה של המפעל הזה צפופה יותר; ההצעות מלמדות אותנו את ה-T האמיתי שלו.)");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
