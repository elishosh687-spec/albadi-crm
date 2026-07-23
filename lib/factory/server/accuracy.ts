/**
 * Aggregate pricing-accuracy stats — "כמה המחשבון שלי מדויק".
 *
 * Two deterministic comparisons, no LLM:
 *  1. draft ↔ factory — per lead, the latest FINALIZED quote vs its estimate
 *     (same-row draftEstimate snapshot, else the lead's latest priced draft) —
 *     EXACTLY the pairing DraftVsFactoryStrip renders, so the aggregate always
 *     agrees with what Eli sees per-lead. Gaps on unit price, CBM, shipping ₪.
 *  2. planned ↔ actual — WON+finalized quotes with saved actualCosts:
 *     factory/shipping overrun % and real-profit gap % (revenue side included
 *     when actualRevenueIls was pulled from Zoho).
 *
 * Consumed by GET /api/widget/factory/closed → AccuracyStrip.
 */

import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { desc, eq, inArray, or, sql } from "drizzle-orm";
import type { FactoryPricingResult, QuoteActualCosts } from "@/lib/factory/types";

export interface GapStat {
  /** Number of pairs measured. */
  n: number;
  /** Mean of |gap| % — headline "how far off am I typically". */
  meanAbsPct: number;
  /** Median of |gap| % — robust to one blown quote. */
  medianAbsPct: number;
  /** Mean SIGNED gap % — bias direction (+ = factory/actual higher than my estimate). */
  meanSignedPct: number;
  /** Mean |gap| % over the 10 most recent pairs (null when n < 4). */
  recentMeanAbsPct: number | null;
}

export interface AccuracyStats {
  draftVsFactory: {
    unitPrice: GapStat | null;
    cbm: GapStat | null;
    shipping: GapStat | null;
  };
  plannedVsActual: {
    factoryCost: GapStat | null;
    shippingCost: GapStat | null;
    profit: GapStat | null;
  };
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Signed gap % of actual vs estimate; null when either side is missing/zero. */
function gapPct(estimate: number | null, actual: number | null): number | null {
  if (estimate === null || actual === null || estimate === 0) return null;
  return ((actual - estimate) / Math.abs(estimate)) * 100;
}

/** Fold a list of {gap, at} into a GapStat (newest-first for the recent slice). */
function buildStat(pairs: { gap: number; at: number }[]): GapStat | null {
  if (pairs.length === 0) return null;
  const abs = pairs.map((p) => Math.abs(p.gap)).sort((a, b) => a - b);
  const mid = Math.floor(abs.length / 2);
  const median = abs.length % 2 ? abs[mid] : (abs[mid - 1] + abs[mid]) / 2;
  const meanAbs = abs.reduce((s, v) => s + v, 0) / abs.length;
  const meanSigned = pairs.reduce((s, p) => s + p.gap, 0) / pairs.length;
  const recent = [...pairs].sort((a, b) => b.at - a.at).slice(0, 10);
  const recentMean =
    pairs.length >= 4 ? recent.reduce((s, p) => s + Math.abs(p.gap), 0) / recent.length : null;
  return {
    n: pairs.length,
    meanAbsPct: meanAbs,
    medianAbsPct: median,
    meanSignedPct: meanSigned,
    recentMeanAbsPct: recentMean,
  };
}

export async function computeAccuracyStats(): Promise<AccuracyStats> {
  // Every row that can participate in either comparison.
  const rows = await db
    .select({
      id: factoryQuoteRequests.id,
      leadSid: factoryQuoteRequests.manychatSubId,
      status: factoryQuoteRequests.factoryStatus,
      finalPricing: factoryQuoteRequests.finalPricing,
      draftEstimate: factoryQuoteRequests.draftEstimate,
      actualCosts: factoryQuoteRequests.actualCosts,
      createdAt: factoryQuoteRequests.createdAt,
    })
    .from(factoryQuoteRequests)
    .where(
      or(
        eq(factoryQuoteRequests.factoryStatus, "finalized"),
        eq(factoryQuoteRequests.factoryStatus, "draft")
      )
    )
    .orderBy(desc(factoryQuoteRequests.createdAt))
    .limit(1000);

  // ---- 1. draft ↔ factory (same pairing as DraftVsFactoryStrip) ----
  const byLead = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = (r.leadSid ?? "").trim();
    if (!k) continue;
    const list = byLead.get(k);
    if (list) list.push(r);
    else byLead.set(k, [r]);
  }

  const unitPairs: { gap: number; at: number }[] = [];
  const cbmPairs: { gap: number; at: number }[] = [];
  const shipPairs: { gap: number; at: number }[] = [];

  for (const list of byLead.values()) {
    // rows are newest-first already (query order); first finalized w/ pricing.
    const factory = list.find((r) => r.status === "finalized" && r.finalPricing);
    if (!factory) continue;
    let est: Record<string, unknown> | null = null;
    if (factory.draftEstimate) {
      est = factory.draftEstimate as Record<string, unknown>;
    } else {
      const draft = list.find((r) => r.status === "draft" && r.finalPricing);
      if (draft) est = draft.finalPricing as Record<string, unknown>;
    }
    if (!est) continue;
    const fp = factory.finalPricing as Record<string, unknown>;
    const at = +factory.createdAt;
    // Compare the raw FACTORY COST (unitCost), not the customer selling price —
    // that's the number Eli estimates and wants to validate against reality.
    const u = gapPct(num(est.unitCost), num(fp.unitCost));
    const c = gapPct(num(est.totalCbm), num(fp.totalCbm));
    const s = gapPct(num(est.totalShipping), num(fp.totalShipping));
    if (u !== null) unitPairs.push({ gap: u, at });
    if (c !== null) cbmPairs.push({ gap: c, at });
    if (s !== null) shipPairs.push({ gap: s, at });
  }

  // ---- 2. planned ↔ actual (WON + finalized + saved actuals) ----
  const finalizedSids = [
    ...new Set(
      rows
        .filter((r) => r.status === "finalized" && r.actualCosts)
        .map((r) => (r.leadSid ?? "").trim())
        .filter(Boolean)
    ),
  ];
  const wonSids = new Set<string>();
  const stageRows = finalizedSids.length
    ? await db
        .select({
          sid: sql<string>`trim(${leads.manychatSubId})`,
          stage: leads.pipelineStage,
        })
        .from(leads)
        .where(inArray(sql`trim(${leads.manychatSubId})`, finalizedSids))
    : [];
  for (const r of stageRows) if (r.stage === "WON") wonSids.add(r.sid);

  const factPairs: { gap: number; at: number }[] = [];
  const shipActPairs: { gap: number; at: number }[] = [];
  const profitPairs: { gap: number; at: number }[] = [];

  for (const r of rows) {
    if (r.status !== "finalized" || !r.finalPricing || !r.actualCosts) continue;
    if (!wonSids.has((r.leadSid ?? "").trim())) continue;
    const fp = r.finalPricing as FactoryPricingResult;
    const ac = r.actualCosts as QuoteActualCosts;
    const at = +r.createdAt;

    const plannedFactory = num(fp.totalCost);
    const plannedShipping = num(fp.totalShipping);
    const plannedProfit = num(fp.totalProfit);
    const plannedRevenue = num(fp.totalSellingPrice);

    const actualFactory = num(ac.factoryTotalIls);
    const actualShipping = num(ac.shippingTotalIls);
    const otherTotal = (ac.otherCosts ?? []).reduce(
      (s, c) => s + (Number(c.amountIls) || 0),
      0
    );
    const revenue = num(ac.actualRevenueIls) ?? plannedRevenue;

    const fg = gapPct(plannedFactory, actualFactory);
    const sg = gapPct(plannedShipping, actualShipping);
    if (fg !== null) factPairs.push({ gap: fg, at });
    if (sg !== null) shipActPairs.push({ gap: sg, at });

    if (plannedProfit !== null && revenue !== null) {
      const aF = actualFactory ?? plannedFactory ?? 0;
      const aS = actualShipping ?? plannedShipping ?? 0;
      const actualProfit = revenue - aF - aS - otherTotal;
      const pg = gapPct(plannedProfit, actualProfit);
      if (pg !== null) profitPairs.push({ gap: pg, at });
    }
  }

  return {
    draftVsFactory: {
      unitPrice: buildStat(unitPairs),
      cbm: buildStat(cbmPairs),
      shipping: buildStat(shipPairs),
    },
    plannedVsActual: {
      factoryCost: buildStat(factPairs),
      shippingCost: buildStat(shipActPairs),
      profit: buildStat(profitPairs),
    },
  };
}
