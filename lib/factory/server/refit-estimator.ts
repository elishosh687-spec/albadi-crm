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
import { extractFeishu, looValidate, toCoeffs, bagAreaCm2, normSupplier, colorsFromText, type Pt } from "./estimator-fit";
import { sendEliDM } from "@/lib/notify/eli";

const CURSOR_KEY = "estimator.last_refit_at";
const GATE_MEDIAN = 6;

/** New real quotes from the DB → per-factory data points for the fit. */
async function dbQuotePoints(): Promise<{ points: Pt[]; latestIso: string | null }> {
  const rows = await db.select().from(factoryQuoteRequests).where(eq(factoryQuoteRequests.factoryStatus, "received"));
  const points: Pt[] = [];
  let latest: Date | null = null;
  for (const row of rows) {
    const resp = row.factoryResponse as FactoryResponse | null;
    const spec = row.productSpec as FactoryProductSpec | null;
    if (!resp || !spec) continue;
    if (row.updatedAt && (!latest || row.updatedAt > latest)) latest = row.updatedAt;
    const unit = resp.unitCostCny;
    if (!unit || unit <= 0) continue;
    if (!/80\s*(g|克|gsm)/i.test(spec.material ?? "") || /kraft|牛皮|card|食品|food|140|110|250/i.test(spec.material ?? "")) continue;
    const h = spec.heightCm, w = spec.widthCm, d = spec.depthCm ?? 0;
    if (!h || !w) continue;
    const fin = (spec.finishing ?? "").toLowerCase();
    points.push({
      factory: normSupplier(resp.supplier ?? ""), size: `H${h}${d ? `*D${d}` : ""}*W${w}`,
      area: bagAreaCm2(h, d, w), colors: colorsFromText(spec.printing ?? "1"),
      hasHandle: /handle|ידיות/i.test(fin) && !/no handle|not.*handle|ללא/i.test(fin),
      hasLam: /laminat/i.test(fin) && !/not laminat|non laminat/i.test(fin),
      qty: spec.quantity ?? 0, price: unit, src: "db",
    });
  }
  return { points, latestIso: latest ? latest.toISOString() : null };
}

export interface RefitResult {
  ok: boolean; published: boolean; reason: string;
  newMedianPct: number | null; prevMedianPct: number | null;
  dbPoints: number; catalogPoints: number; quoteLogPoints: number; misaligned: number;
  dmStatus?: string;
}

export async function refitEstimator(opts?: { fittedAt?: string }): Promise<RefitResult> {
  const fittedAt = opts?.fittedAt ?? new Date().toISOString().slice(0, 10);
  const { cat, ql, misaligned } = await extractFeishu();
  const { points: dbPts, latestIso } = await dbQuotePoints();
  const qlAll = [...ql, ...dbPts]; // DB quotes feed the fit alongside the quote-log

  const loo = looValidate(cat, qlAll);
  const newMedian = loo.stats?.median ?? null;
  const prev = await getEstimatorCoeffs({ fresh: true });
  const prevMedian = prev.accuracy?.medianPct ?? null;

  const passesGate = newMedian != null && newMedian <= GATE_MEDIAN;
  const notWorse = prevMedian == null || newMedian == null || newMedian <= prevMedian + 2;
  const publish = passesGate && notWorse;

  let reason: string;
  if (publish) {
    await setEstimatorCoeffs(toCoeffs(cat, qlAll, loo, fittedAt));
    reason = "published";
  } else if (!passesGate) {
    reason = `kept old — new median ${newMedian?.toFixed(1)}% > ${GATE_MEDIAN}% gate`;
  } else {
    reason = `kept old — new median ${newMedian?.toFixed(1)}% materially worse than current ${prevMedian?.toFixed(1)}%`;
  }

  // advance cursor (audit only — the fit always reads the full set)
  await db.insert(appConfig).values({ key: CURSOR_KEY, value: { iso: latestIso ?? fittedAt, at: fittedAt } })
    .onConflictDoUpdate({ target: appConfig.key, set: { value: { iso: latestIso ?? fittedAt, at: fittedAt }, updatedAt: new Date() } });

  const dm = publish
    ? `📊 מחירון אומדן עודכן\nדיוק חציון ${prevMedian != null ? `${prevMedian.toFixed(1)}%→` : ""}${newMedian?.toFixed(1)}%\nנקודות: קטלוג ${cat.length} · לוג ${ql.length} · DB ${dbPts.length}`
    : `⚠️ מחירון אומדן לא עודכן (${reason}).\nנשמרו הנוסחאות הקודמות. נקודות DB חדשות: ${dbPts.length}`;
  const dmStatus = await sendEliDM(dm);

  return { ok: true, published: publish, reason, newMedianPct: newMedian, prevMedianPct: prevMedian, dbPoints: dbPts.length, catalogPoints: cat.length, quoteLogPoints: ql.length, misaligned, dmStatus };
}
