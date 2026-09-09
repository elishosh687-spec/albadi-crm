/** Freeze ALL carton data points (catalog + DB, 80g non-woven) as JSON for the workflow. */
import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";

const area = (h: number, d: number, w: number) => 2 * h * w + 2 * h * d + w * d;

async function main() {
  const out: Record<string, unknown>[] = [];
  for (const p of DEFAULT_CONFIG.products) {
    const m = p.dimensions.replace(/×/g, "*").match(/H(\d+)(?:\*D(\d+))?\*W(\d+)/i);
    if (!m) continue;
    const H = +m[1], D = m[2] ? +m[2] : 0, W = +m[3];
    for (const [hasHandle, v] of [[true, p.withHandles], [false, p.withoutHandles]] as const) {
      const c = v.carton;
      out.push({ src: "catalog", id: p.id, factory: "catalog", H, D, W, area: area(H, D, W), hasHandle,
        cq: c.qty, cartonCbm: +(c.length * c.width * c.height / 1e6).toFixed(5), cartonL: c.length, cartonW: c.width, cartonH: c.height,
        cbmU: (c.length * c.width * c.height / 1e6) / c.qty });
    }
  }
  type Resp = { supplier?: string; cartonQty?: number; cartonCbm?: number; cartonLengthCm?: number; cartonWidthCm?: number; cartonHeightCm?: number; weightKg?: number };
  type Spec = { material?: string; heightCm?: number; widthCm?: number; depthCm?: number; finishing?: string };
  const rows = await db.select().from(factoryQuoteRequests);
  const seen = new Set<string>();
  for (const row of rows) {
    const resp = row.factoryResponse as Resp | null; const spec = row.productSpec as Spec | null;
    if (!resp || !spec) continue;
    const ok80 = /80\s*(g|克|gsm)/i.test(spec.material ?? "") && !/kraft|牛皮|card|食品|food|140|110|250/i.test(spec.material ?? "");
    if (!ok80) continue;
    const H = spec.heightCm ?? 0, W = spec.widthCm ?? 0, D = spec.depthCm ?? 0;
    if (!H || !W) continue;
    const cq = resp.cartonQty ?? 0;
    const cl = resp.cartonLengthCm, cw = resp.cartonWidthCm, ch = resp.cartonHeightCm;
    const cbm = resp.cartonCbm ?? (cl && cw && ch ? (cl * cw * ch) / 1e6 : 0);
    if (cq <= 0 || cbm <= 0) continue;
    const cbmU = cbm / cq; const key = `${H}|${D}|${W}|${cbmU.toFixed(6)}`;
    if (seen.has(key)) continue; seen.add(key);
    const fin = (spec.finishing ?? "").toLowerCase();
    out.push({ src: "db", id: row.quotationNo ?? "?", factory: (resp.supplier ?? "?"), H, D, W, area: area(H, D, W),
      hasHandle: /handle|ידי/i.test(fin) && !/no handle|ללא/i.test(fin),
      cq, cartonCbm: +cbm.toFixed(5), cartonL: cl ?? null, cartonW: cw ?? null, cartonH: ch ?? null, cbmU });
  }
  console.log(JSON.stringify(out));
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
