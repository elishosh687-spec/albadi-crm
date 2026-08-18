/**
 * Test the GREEN (Mandy) formulas against the real GREEN quotes in
 * factory_quote_requests (supplier 华庆-Mandy). PRICE: catalog-only base →
 * quote is out-of-sample. SHIPPING: physical T×area vs actual carton. READ-ONLY.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { extractFeishu, buildModel, predict, pct, bagAreaCm2, normSupplier, dimsStr, colorsFromText } from "@/lib/factory/server/estimator-fit";
import { DEFAULT_CARTON_COEF } from "@/lib/factory/estimator-config";

const T_MANDY = DEFAULT_CARTON_COEF.perFactoryTMm!["Mandy"]; // 0.84 mm
const parseHandle = (f: string) => /with handle|handles\b|ידיות/i.test(f) && !/no handle|non handle|ללא/i.test(f);
const parseLam = (f: string) => /laminat/i.test(f) && !/not laminat|non laminat/i.test(f);

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const { cat, ql } = await extractFeishu();
  const model = buildModel(cat, ql, "Mandy");
  const rows: any[] = await sql`SELECT quotation_no, product_spec as ps, factory_response as fr FROM factory_quote_requests`;

  const green = rows.filter((r) => normSupplier(((r.fr ?? {}).supplier ?? "").toString()) === "Mandy");
  console.log(`\n🟢 מבחן הנוסחה הירוקה מול ${green.length} הצעות ירוקות אמת (华庆-Mandy)\n`);

  const perr: number[] = [], serr: number[] = [];
  console.log(" שקית            | שטח | כמות | וריאנט      | מחיר אמת→חזוי | שילוח cbm/יח׳ אמת→חזוי");
  console.log(" " + "─".repeat(84));
  for (const r of green.sort((a, b) => (a.ps?.quantity ?? 0) - (b.ps?.quantity ?? 0))) {
    const ps = r.ps ?? {}, fr = r.fr ?? {};
    const dm = dimsStr(`H${ps.heightCm}*D${ps.depthCm ?? 0}*W${ps.widthCm}`) ?? { h: ps.heightCm, d: ps.depthCm ?? 0, w: ps.widthCm };
    const area = bagAreaCm2(dm.h, dm.d, dm.w);
    const colors = colorsFromText((ps.printing ?? "1").toString());
    const hasHandle = parseHandle((ps.finishing ?? "").toString());
    const hasLam = parseLam((ps.finishing ?? "").toString());
    const qty = ps.quantity ?? 0;
    const dimStr = `${dm.h}×${dm.w}×D${dm.d}`;
    const variant = `${hasHandle ? "ידית" : "בלי"}${hasLam ? "·למ" : ""} ${colors}צ`;

    // PRICE
    const pr = predict(model, { area, qty, hasHandle, hasLam, colors });
    let priceCell = "—";
    if (pr && pr.conf === "high" && fr.unitCostCny > 0) {
      const e = (pr.unit - fr.unitCostCny) / fr.unitCostCny * 100;
      perr.push(e);
      priceCell = `¥${fr.unitCostCny}→¥${pr.unit.toFixed(2)} ${(e >= 0 ? "+" : "") + e.toFixed(0)}%${Math.abs(e) > 12 ? "❌" : Math.abs(e) > 8 ? "⚠️" : "✅"}`;
    } else if (pr && pr.conf === "low") priceCell = "מחוץ לטווח";
    else if (!pr) priceCell = hasLam ? "אין נוסחת למ" : "—";

    // SHIPPING (only meaningful for gusseted 3D)
    let shipCell = "—";
    if (fr.cartonQty > 0 && fr.cartonCbm > 0 && dm.d > 2) {
      const actualPerUnit = fr.cartonCbm / fr.cartonQty;
      const predPerUnit = T_MANDY * area * 1e-7;
      const e = (predPerUnit - actualPerUnit) / actualPerUnit * 100;
      serr.push(e);
      shipCell = `${actualPerUnit.toFixed(5)}→${predPerUnit.toFixed(5)} ${(e >= 0 ? "+" : "") + e.toFixed(0)}%${Math.abs(e) > 12 ? "❌" : Math.abs(e) > 8 ? "⚠️" : "✅"}`;
    }
    console.log(` ${dimStr.padEnd(15)}| ${String(Math.round(area)).padStart(4)}| ${String(qty).padStart(5)}| ${variant.padEnd(11)}| ${priceCell.padEnd(22)}| ${shipCell}`);
  }

  const ps = perr.length ? pct(perr) : null, ss = serr.length ? pct(serr) : null;
  console.log("\n── סיכום ירוק ──");
  if (ps) console.log(`  מחיר:  נבחנו ${ps.n} · |חציון| ${Math.abs(ps.median).toFixed(1)}% · ממוצע ${ps.mean.toFixed(1)}% · max ${ps.max.toFixed(0)}% · ≤8%: ${perr.filter((e) => Math.abs(e) <= 8).length}/${perr.length}`);
  if (ss) console.log(`  שילוח: נבחנו ${ss.n} · |חציון| ${Math.abs(ss.median).toFixed(1)}% · ממוצע ${ss.mean.toFixed(1)}% · max ${ss.max.toFixed(0)}% · ≤8%: ${serr.filter((e) => Math.abs(e) <= 8).length}/${serr.length}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
