/**
 * Parameterized: test a factory's formulas (base + shipping) against its real
 * quotes in factory_quote_requests. Usage: tsx _test-factory-quotes.ts <Mandy|亚森>
 * PRICE: catalog-only base → quotes are out-of-sample. SHIPPING: per-factory T×area.
 * READ-ONLY.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { extractFeishu, buildModel, predict, pct, bagAreaCm2, normSupplier, dimsStr, colorsFromText } from "@/lib/factory/server/estimator-fit";
import { DEFAULT_CARTON_COEF } from "@/lib/factory/estimator-config";

const FAC = process.argv[2] || "Mandy";
const T_FAC = DEFAULT_CARTON_COEF.perFactoryTMm![FAC] ?? DEFAULT_CARTON_COEF.tMmGusseted;
const parseHandle = (f: string) => /with handle|handles\b|ידיות/i.test(f) && !/no handle|non handle|ללא/i.test(f);
const parseLam = (f: string) => /laminat/i.test(f) && !/not laminat|non laminat/i.test(f);

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const { cat, ql } = await extractFeishu();

  // catalog inventory for this factory
  const fc = cat.filter((p) => p.factory === FAC);
  const sizes = [...new Set(fc.map((p) => p.size))];
  console.log(`\n═══ מפעל ${FAC} · T=${T_FAC}mm ═══`);
  console.log(`קטלוג: ${fc.length} נקודות · ${sizes.length} מידות · למינציה=${fc.filter((p) => p.hasLam).length}`);
  for (const s of sizes) { const d3 = /D\d/.test(s); console.log(`   ${d3 ? "3D" : "2D"} ${s}`); }

  const model = buildModel(cat, ql, FAC);
  const rows: any[] = await sql`SELECT quotation_no, product_spec as ps, factory_response as fr FROM factory_quote_requests`;
  const mine = rows.filter((r) => normSupplier(((r.fr ?? {}).supplier ?? "").toString()) === FAC);
  console.log(`\nמבחן מול ${mine.length} הצעות אמת:\n`);
  console.log(" שקית            | שטח | כמות | וריאנט      | מחיר אמת→חזוי         | שילוח m³/1000 אמת→חזוי");
  console.log(" " + "─".repeat(90));

  const perr: number[] = [], serr: number[] = [];
  for (const r of mine.sort((a, b) => (a.ps?.quantity ?? 0) - (b.ps?.quantity ?? 0))) {
    const ps = r.ps ?? {}, fr = r.fr ?? {};
    const dm = { h: ps.heightCm, d: ps.depthCm ?? 0, w: ps.widthCm };
    const area = bagAreaCm2(dm.h, dm.d, dm.w);
    const colors = colorsFromText((ps.printing ?? "1").toString());
    const hasHandle = parseHandle((ps.finishing ?? "").toString());
    const hasLam = parseLam((ps.finishing ?? "").toString());
    const qty = ps.quantity ?? 0;
    const over = qty > 10000;
    const variant = `${hasHandle ? "ידית" : "בלי"}${hasLam ? "·למ" : ""} ${colors}צ`;

    const pr = predict(model, { area, qty, hasHandle, hasLam, colors });
    let priceCell = "—";
    if (pr && fr.unitCostCny > 0) {
      const e = (pr.unit - fr.unitCostCny) / fr.unitCostCny * 100;
      if (!over) perr.push(e);
      priceCell = `¥${fr.unitCostCny}→¥${pr.unit.toFixed(2)} ${(e >= 0 ? "+" : "") + e.toFixed(0)}%${Math.abs(e) > 12 ? "❌" : Math.abs(e) > 8 ? "⚠️" : "✅"}`;
    } else if (!pr) priceCell = hasLam ? "אין נוסחת למ (כחול תופר)" : "—";

    let shipCell = "—";
    if (fr.cartonQty > 0 && fr.cartonCbm > 0 && dm.d > 2) {
      const actual = (fr.cartonCbm / fr.cartonQty) * 1000, pred = T_FAC * area * 1e-7 * 1000;
      const e = (pred - actual) / actual * 100;
      if (!over) serr.push(e);
      shipCell = `${actual.toFixed(2)}→${pred.toFixed(2)} ${(e >= 0 ? "+" : "") + e.toFixed(0)}%${Math.abs(e) > 12 ? "❌" : Math.abs(e) > 8 ? "⚠️" : "✅"}`;
    }
    console.log(` ${`${dm.h}×${dm.w}×D${dm.d}`.padEnd(15)}| ${String(Math.round(area)).padStart(4)}| ${String(qty).padStart(5)}${over ? "*" : " "}| ${variant.padEnd(11)}| ${priceCell.padEnd(22)}| ${shipCell}`);
  }
  const psS = perr.length ? pct(perr) : null, ssS = serr.length ? pct(serr) : null;
  console.log("\n── סיכום (כמות ≤10,000 בלבד; * = מעל, לא נספר) ──");
  if (psS) console.log(`  מחיר:  n=${psS.n} · |חציון| ${Math.abs(psS.median).toFixed(1)}% · ממוצע ${psS.mean.toFixed(1)}% · max ${psS.max.toFixed(0)}% · ≤8%: ${perr.filter((e) => Math.abs(e) <= 8).length}/${perr.length}`);
  if (ssS) console.log(`  שילוח: n=${ssS.n} · |חציון| ${Math.abs(ssS.median).toFixed(1)}% · ממוצע ${ssS.mean.toFixed(1)}% · max ${ssS.max.toFixed(0)}% · ≤8%: ${serr.filter((e) => Math.abs(e) <= 8).length}/${serr.length}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
