/**
 * Self-improving auto-refit: pull newly-arrived factory quotes, re-read the live
 * catalog + quote-log, re-fit the per-factory estimator, and PUBLISH the new
 * coefficients only if accuracy still passes the gate. Otherwise keep the old
 * ones and warn Eli. Runs daily (vercel.json cron) → /api/factory/refit-estimator.
 */
import { db } from "@/lib/db";
import { appConfig, factoryQuoteRequests } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import type { FactoryProductSpec, FactoryResponse } from "@/lib/factory/types";
import { getEstimatorCoeffs, setEstimatorCoeffs } from "@/lib/factory/estimator-config";
import { extractFeishu, looValidate, toCoeffs, bagAreaCm2, normSupplier, colorsFromText, catalogCartonPts, toCartonCoef, type Pt, type CartonPt } from "./estimator-fit";
import { sendEliDM } from "@/lib/notify/eli";

const CURSOR_KEY = "estimator.last_refit_at";
const GATE_MEDIAN = 6;

/** New real quotes from the DB → per-factory PRICE points + CARTON points for the fits. */
async function dbQuotePoints(): Promise<{ points: Pt[]; cartonPoints: CartonPt[]; latestIso: string | null }> {
  // carton data also lives on FINALIZED quotes (not only 'received'), so include both.
  const rows = await db.select().from(factoryQuoteRequests);
  const points: Pt[] = [];
  const cartonPoints: CartonPt[] = [];
  const cartonSeen = new Set<string>();
  let latest: Date | null = null;
  for (const row of rows) {
    const resp = row.factoryResponse as FactoryResponse | null;
    const spec = row.productSpec as FactoryProductSpec | null;
    if (!resp || !spec) continue;
    const is80gNonWoven = /80\s*(g|克|gsm)/i.test(spec.material ?? "") && !/kraft|牛皮|card|食品|food|140|110|250/i.test(spec.material ?? "");
    const h = spec.heightCm, w = spec.widthCm, d = spec.depthCm ?? 0;
    if (!h || !w || !is80gNonWoven) continue;
    const area = bagAreaCm2(h, d, w);

    // PRICE point (received quotes with a unit cost, mirrors the price model feed).
    if (row.factoryStatus === "received") {
      if (row.updatedAt && (!latest || row.updatedAt > latest)) latest = row.updatedAt;
      const unit = resp.unitCostCny;
      if (unit && unit > 0) {
        const fin = (spec.finishing ?? "").toLowerCase();
        points.push({
          factory: normSupplier(resp.supplier ?? ""), size: `H${h}${d ? `*D${d}` : ""}*W${w}`,
          area, colors: colorsFromText(spec.printing ?? "1"),
          hasHandle: /handle|ידיות/i.test(fin) && !/no handle|not.*handle|ללא/i.test(fin),
          hasLam: /laminat/i.test(fin) && !/not laminat|non laminat/i.test(fin),
          qty: spec.quantity ?? 0, price: unit, src: "db",
        });
      }
    }

    // CARTON point (any status with carton master data: cartonQty + cbm/dims).
    const cq = resp.cartonQty ?? 0;
    const cbm = resp.cartonCbm ?? (resp.cartonLengthCm && resp.cartonWidthCm && resp.cartonHeightCm ? (resp.cartonLengthCm * resp.cartonWidthCm * resp.cartonHeightCm) / 1e6 : 0);
    if (cq > 0 && cbm > 0) {
      const cbmPerUnit = cbm / cq;
      const tImplied = (cbmPerUnit / area) * 1e7; // guard against bad rows (e.g. FIRBM6CX ~1.6mm)
      const key = `${h}|${d}|${w}|${cbmPerUnit.toFixed(6)}`;
      if (tImplied >= 0.3 && tImplied <= 1.4 && !cartonSeen.has(key)) {
        cartonSeen.add(key);
        cartonPoints.push({ factory: normSupplier(resp.supplier ?? ""), area, depth: d, height: h, cbmPerUnit, src: "db" });
      }
    }
  }
  return { points, cartonPoints, latestIso: latest ? latest.toISOString() : null };
}

export interface RefitResult {
  ok: boolean; published: boolean; reason: string;
  newMedianPct: number | null; prevMedianPct: number | null;
  dbPoints: number; catalogPoints: number; quoteLogPoints: number; misaligned: number;
  cartonMedianPct: number | null; cartonPoints: number;
  dmStatus?: string;
}

export async function refitEstimator(opts?: { fittedAt?: string }): Promise<RefitResult> {
  const fittedAt = opts?.fittedAt ?? new Date().toISOString().slice(0, 10);
  const { cat, ql, misaligned } = await extractFeishu();
  const { points: dbPts, cartonPoints: dbCartonPts, latestIso } = await dbQuotePoints();
  const qlAll = [...ql, ...dbPts]; // DB quotes feed the fit alongside the quote-log

  const loo = looValidate(cat, qlAll);
  const newMedian = loo.stats?.median ?? null;
  const prev = await getEstimatorCoeffs({ fresh: true });
  const prevMedian = prev.accuracy?.medianPct ?? null;

  // Carton model: catalog packing + DB carton points → T (gusseted scope, verified cleaning baked in).
  const cartonPts = [...catalogCartonPts(), ...dbCartonPts];
  const cartonCoef = toCartonCoef(cartonPts, fittedAt);
  const cartonMedian = cartonCoef.accuracy?.medianPct ?? null;
  // Keep the new carton block only if it still passes the ≤10% gate; else retain the previous one.
  const cartonOk = cartonMedian != null && cartonMedian <= 10;
  const publishCarton = cartonOk ? cartonCoef : (prev.carton ?? cartonCoef);

  const passesGate = newMedian != null && newMedian <= GATE_MEDIAN;
  const notWorse = prevMedian == null || newMedian == null || newMedian <= prevMedian + 2;
  const publish = passesGate && notWorse;

  let reason: string;
  if (publish) {
    await setEstimatorCoeffs(toCoeffs(cat, qlAll, loo, fittedAt, publishCarton));
    reason = "published";
  } else if (!passesGate) {
    reason = `kept old — new median ${newMedian?.toFixed(1)}% > ${GATE_MEDIAN}% gate`;
  } else {
    reason = `kept old — new median ${newMedian?.toFixed(1)}% materially worse than current ${prevMedian?.toFixed(1)}%`;
  }

  // advance cursor (audit only — the fit always reads the full set)
  await db.insert(appConfig).values({ key: CURSOR_KEY, value: { iso: latestIso ?? fittedAt, at: fittedAt } })
    .onConflictDoUpdate({ target: appConfig.key, set: { value: { iso: latestIso ?? fittedAt, at: fittedAt }, updatedAt: new Date() } });

  const cartonLine = `📦 אריזה: CBM/יח׳ דיוק חציון ${cartonMedian?.toFixed(1)}% (${cartonCoef.accuracy?.n ?? 0} גזורות${cartonOk ? "" : " — לא עודכן, מתחת לסף"})`;
  const dm = publish
    ? `📊 מחירון אומדן עודכן\nדיוק חציון ${prevMedian != null ? `${prevMedian.toFixed(1)}%→` : ""}${newMedian?.toFixed(1)}%\nנקודות: קטלוג ${cat.length} · לוג ${ql.length} · DB ${dbPts.length}\n${cartonLine}`
    : `⚠️ מחירון אומדן לא עודכן (${reason}).\nנשמרו הנוסחאות הקודמות. נקודות DB חדשות: ${dbPts.length}\n${cartonLine}`;
  const dmStatus = await sendEliDM(dm);

  return { ok: true, published: publish, reason, newMedianPct: newMedian, prevMedianPct: prevMedian, dbPoints: dbPts.length, catalogPoints: cat.length, quoteLogPoints: ql.length, misaligned, cartonMedianPct: cartonMedian, cartonPoints: cartonPts.length, dmStatus };
}
