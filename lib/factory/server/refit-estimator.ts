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
import { extractFeishu, looValidate, toCoeffs, bagAreaCm2, normSupplier, colorsFromText, catalogCartonPts, toCartonCoef, gateFactory, FACS, type Pt, type CartonPt, type FactoryGate } from "./estimator-fit";
import { FACTORY_LABEL } from "@/lib/factory/estimator-defaults";
import { sendEliDM } from "@/lib/notify/eli";

/** Also holds the last run's outcome — the settings "דיוק המחשבון" screen reads it. */
export const CURSOR_KEY = "estimator.last_refit_at";

/** New real quotes from the DB → per-factory PRICE points + CARTON points for the fits. */
export async function dbQuotePoints(): Promise<{ points: Pt[]; cartonPoints: CartonPt[]; latestIso: string | null }> {
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
  ok: boolean;
  /** true when at least one factory's formula was published. */
  published: boolean; reason: string;
  /** Each factory judged on its own quotes and published on its own. */
  perFactory: FactoryGate[];
  /** All modelled quotes together — informational only, no longer the gate. */
  newMedianPct: number | null; prevMedianPct: number | null;
  dbPoints: number; catalogPoints: number; quoteLogPoints: number; misaligned: number;
  cartonMedianPct: number | null; cartonPoints: number; cartonPublished: boolean;
  /** What the formula is built from: laminated quotes of a modelled factory feed the
   *  lam line; plain ones grade the catalog-based line; other factories have no model. */
  quotesLearned: number; quotesGradingOnly: number; quotesUnmodelled: number;
  dmStatus?: string;
  /** dryRun only: the WhatsApp that WOULD have been sent. */
  dmPreview?: string;
}

/**
 * `dryRun`: fit + judge exactly like the cron, but write nothing and send
 * nothing — for showing Eli the outcome before a change goes live.
 */
export async function refitEstimator(opts?: { fittedAt?: string; dryRun?: boolean }): Promise<RefitResult> {
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

  // Each factory: its own quotes, its own gate, its own publish.
  const perFactory = FACS.map((f) =>
    gateFactory(f, looValidate(cat, qlAll.filter((p) => p.factory === f)), prev.factories[f]?.accuracy?.medianPct ?? null));
  const publish = perFactory.some((g) => g.publish);
  const fresh = toCoeffs(cat, qlAll, loo, fittedAt, publishCarton);
  const next = {
    ...fresh,
    fittedAt: publish ? fittedAt : prev.fittedAt,
    factories: Object.fromEntries(perFactory.map((g) => [g.factory, g.publish
      ? { ...fresh.factories[g.factory], accuracy: g.newMedianPct != null ? { medianPct: g.newMedianPct, maxPct: g.maxPct!, n: g.n } : null, fittedAt }
      : { ...prev.factories[g.factory], fittedAt: prev.factories[g.factory]?.fittedAt ?? prev.fittedAt }])),
  };
  if (publish && !opts?.dryRun) await setEstimatorCoeffs(next);
  const label = (f: string) => FACTORY_LABEL[f] ?? f;
  const reason = perFactory.map((g) => `${label(g.factory)}: ${g.reason}`).join(" · ");
  const modelled = (p: Pt) => (FACS as readonly string[]).includes(p.factory);
  const quotesLearned = qlAll.filter((p) => p.hasLam && modelled(p)).length;
  const quotesGradingOnly = qlAll.filter((p) => !p.hasLam && modelled(p)).length;
  const quotesUnmodelled = qlAll.filter((p) => !modelled(p)).length;
  const result = {
    published: publish, reason, perFactory, newMedianPct: newMedian, prevMedianPct: prevMedian,
    dbPoints: dbPts.length, catalogPoints: cat.length, quoteLogPoints: ql.length, misaligned,
    cartonMedianPct: cartonMedian, cartonPoints: cartonPts.length, cartonPublished: cartonOk,
    quotesLearned, quotesGradingOnly, quotesUnmodelled,
  };

  const cartonLine = `📦 אריזה: CBM/יח׳ דיוק חציון ${cartonMedian?.toFixed(1)}% (${cartonCoef.accuracy?.n ?? 0} גזורות${cartonOk ? "" : " — מעל הסף 10%, לא עודכן"})`;
  const facLine = (g: FactoryGate) => g.publish
    ? `✅ ${label(g.factory)}: עודכן · דיוק ${g.prevMedianPct != null ? `${g.prevMedianPct.toFixed(1)}%→` : ""}${g.newMedianPct!.toFixed(1)}% (${g.n} הצעות)`
    : `⚠️ ${label(g.factory)}: לא עודכן — ${g.n === 0 ? "אין הצעות לבדיקה" : `דיוק ${g.newMedianPct!.toFixed(1)}%${g.newMedianPct! > 6 ? " מעל הסף 6%" : ` גרוע מהקודם ${g.prevMedianPct?.toFixed(1)}%`}`} (${g.n} הצעות), נשארה הנוסחה הקודמת`;
  const dm = `📊 כיול המחשבון המשוער\n${perFactory.map(facLine).join("\n")}\nנקודות: קטלוג ${cat.length} · לוג ${ql.length} · DB ${dbPts.length}\n${cartonLine}`;
  if (opts?.dryRun) return { ok: true, ...result, dmPreview: dm };

  // Cursor + last outcome (the fit always reads the full set; this is for the settings screen).
  const cursor = { iso: latestIso ?? fittedAt, at: fittedAt, ranAt: new Date().toISOString(), result };
  await db.insert(appConfig).values({ key: CURSOR_KEY, value: cursor })
    .onConflictDoUpdate({ target: appConfig.key, set: { value: cursor, updatedAt: new Date() } });
  const dmStatus = await sendEliDM(dm);

  return { ok: true, ...result, dmStatus };
}
