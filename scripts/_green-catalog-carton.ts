/**
 * Fair same-factory check: the GREEN catalog's OWN packing density (T) from its
 * carton columns (装箱数量 I / 长 J / 宽 K / 高 L) vs the green QUOTES' T.
 * If both ≈0.9 → same factory agrees, and the earlier 25% was my WRONG backbone
 * (the generic constants.ts catalog, a different factory). READ-ONLY.
 */
import "dotenv/config";
import { neon } from "@neondatabase/serverless";
import { feishuFetch } from "@/lib/feishu/client";
import { extractFeishu, bagAreaCm2, impliedTmm, isGussetedNormal, normSupplier } from "@/lib/factory/server/estimator-fit";

const CAT = "PBKystZ1dhCsZgtp4qgc2nzxnMf";
const txt = (c: unknown) => Array.isArray(c) ? c.map((s: any) => s?.text ?? "").join("") : c == null ? "" : String(c);
const numOf = (s: unknown) => { if (s == null) return null; const m = String(s).replace(/[，,￥]/g, "").match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null; };
const dimsName = (n: string) => { const m = n.replace(/（.*?）/g, "").match(/H(\d+)(?:-?D(\d+))?-?W(\d+)/i); return m ? { h: +m[1], d: m[2] ? +m[2] : 0, w: +m[3] } : null; };
const median = (a: number[]) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

const GREEN_SIZES = ["H18-D9-W20", "H20-D8", "H30-D10-W30", "H30-D12-W40", "H35-D10-W40", "H40-D15-W45", "H40-D15-W50"];

async function main() {
  const meta = await feishuFetch<{ data: { sheets: { sheet_id: string; title: string }[] } }>(`/open-apis/sheets/v3/spreadsheets/${CAT}/sheets/query`, { method: "GET" });
  const greenTabs = meta.data.sheets.filter((s) => GREEN_SIZES.some((g) => s.title.replace(/（.*?）/g, "").startsWith(g.replace(/-W\d+$/, "")) && /D\d/.test(s.title)));

  console.log("\n🟢 עובי אריזה (T) מהקטלוג הירוק עצמו — עמודות אריזה I/J/K/L:\n");
  const catTs: number[] = [];
  for (const t of greenTabs) {
    const vals = (await feishuFetch<{ data: { valueRange: { values: unknown[][] } } }>(`/open-apis/sheets/v2/spreadsheets/${CAT}/values/${encodeURIComponent(`${t.sheet_id}!A1:Z120`)}`, { method: "GET" })).data?.valueRange?.values ?? [];
    const dm = dimsName(t.title); if (!dm) continue;
    const area = bagAreaCm2(dm.h, dm.d, dm.w);
    const seen = new Set<string>();
    for (const row of vals) {
      const cq = numOf(row?.[8]), L = numOf(row?.[9]), W = numOf(row?.[10]), H = numOf(row?.[11]); // 装箱数量,长,宽,高
      if (!cq || !L || !W || !H) continue;
      const key = `${cq}|${L}|${W}|${H}`; if (seen.has(key)) continue; seen.add(key);
      const cbmPerUnit = (L * W * H / 1e6) / cq;
      const p = { area, depth: dm.d, height: dm.h, cbmPerUnit };
      if (!isGussetedNormal(p)) continue;
      const T = impliedTmm(p as any); catTs.push(T);
      console.log(`  ${t.title.padEnd(15)} קרטון ${L}×${W}×${H} / ${cq}יח׳ → CBM/יח׳ ${cbmPerUnit.toFixed(5)} → T=${T.toFixed(3)}`);
    }
  }

  // quotes T
  const sql = neon(process.env.DATABASE_URL!);
  const rows: any[] = await sql`SELECT product_spec as ps, factory_response as fr FROM factory_quote_requests`;
  const qTs = rows.filter((r) => normSupplier(((r.fr ?? {}).supplier ?? "").toString()) === "Mandy")
    .map((r) => { const ps = r.ps ?? {}, fr = r.fr ?? {}; const area = bagAreaCm2(ps.heightCm, ps.depthCm ?? 0, ps.widthCm); const cq = +fr.cartonQty, cc = +fr.cartonCbm; return { area, depth: ps.depthCm ?? 0, height: ps.heightCm, cbmPerUnit: cq > 0 ? cc / cq : 0, qty: ps.quantity ?? 0 }; })
    .filter((p) => p.cbmPerUnit > 0 && p.qty <= 10000 && isGussetedNormal(p)).map(impliedTmm);

  console.log("\n── השוואת עובי אריזה (T) ──");
  console.log(`  🟢 קטלוג ירוק (华庆):     חציון T=${median(catTs).toFixed(3)}  (n=${catTs.length})`);
  console.log(`  🟢 הצעות ירוקות (华庆):    חציון T=${median(qTs).toFixed(3)}  (n=${qTs.length})`);
  console.log(`  ⚙️ קטלוג גנרי (constants):        T=1.08  ← המקור הלא-נכון שהשתמשתי בו`);
  const gap = Math.abs(median(catTs) - median(qTs)) / median(qTs) * 100;
  console.log(`\n  פער ירוק↔ירוק: ${gap.toFixed(0)}%  → ${gap < 12 ? "✅ אותו מפעל = אותה אריזה. צדקת." : "⚠️ עדיין פער"}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
