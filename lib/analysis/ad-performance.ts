/**
 * Per-ad lead-quality report — "which ad brings money, not just form fills".
 *
 * Deterministic SQL over data the CRM already holds: `leads.meta_ad_name` /
 * `meta_campaign_name` (filled by the Meta-sheet enrichment cron) joined to the
 * pipeline stage, the good-lead marker, and closed-deal revenue. No LLM.
 *
 * The point (Eli, 2026-08-07): volume ≠ quality. `07_chain_cut` produced 34
 * leads but almost none progressed, while `מודעה 1 — מחיר` produced 13 and
 * converted 5× better. This screen makes that visible continuously.
 *
 * See memory meta-conversion-loop.
 */
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { fetchAdSpend } from "@/lib/meta/ads-insights";

export interface AdPerformanceRow {
  adName: string;
  adId: string | null;
  campaignName: string | null;
  leads: number;
  /** Reached an engaged pipeline stage (DISCAVERY / FACTORY_WAIT / CONSIDERATION / WON). */
  engaged: number;
  /** Eli marked it "good lead" in GHL (reported to Meta). */
  markedGood: number;
  won: number;
  /** Sum of closed-deal customer totals (ex-VAT) attributed to this ad. */
  revenueIls: number;
  /** Names of the customers whose deals closed on this ad. */
  dealCustomers: string[];
  /** Names Eli marked "ליד טוב" on this ad. */
  goodLeadNames: string[];
  /** engaged / leads, 0..100. */
  engagedPct: number;
  // ---- phase B (only when META_ADS_TOKEN is set) ----
  /** What Meta charged for this ad in the period, ₪. Null = no spend data. */
  spendIls: number | null;
  /** spend / leads. */
  costPerLeadIls: number | null;
  /** spend / engaged — the number that actually ranks ads. Null when engaged=0. */
  costPerQualityLeadIls: number | null;
  /** revenue − spend. */
  roiIls: number | null;
}

export interface AdPerformanceReport {
  rows: AdPerformanceRow[];
  totals: {
    leads: number;
    engaged: number;
    markedGood: number;
    won: number;
    revenueIls: number;
  };
  /** Leads with no ad attribution (no leadgen id matched). */
  unattributed: number;
  /** Total ad spend for the period, ₪. Null when spend data isn't available. */
  totalSpendIls: number | null;
  /** Why spend is missing (missing/expired token, no data) — shown in the UI. */
  spendUnavailable: string | null;
}

const ENGAGED = sql`pipeline_stage IN ('DISCAVERY','FACTORY_WAIT','CONSIDERATION','WON')`;

export async function buildAdPerformance(
  opts: { sinceDays?: number } = {},
): Promise<AdPerformanceReport> {
  const since = opts.sinceDays && opts.sinceDays > 0 ? opts.sinceDays : null;
  const timeFilter = since
    ? sql`AND l.created_at >= now() - ${`${since} days`}::interval`
    : sql``;

  const res = await db.execute<{
    ad: string;
    ad_id: string | null;
    campaign: string | null;
    leads: number;
    engaged: number;
    marked_good: number;
  }>(sql`
    SELECT l.meta_ad_name AS ad,
           MAX(l.meta_ad_id) AS ad_id,
           MAX(l.meta_campaign_name) AS campaign,
           count(*)::int AS leads,
           count(*) FILTER (WHERE ${ENGAGED})::int AS engaged,
           count(*) FILTER (WHERE l.meta_qualified_sent_at IS NOT NULL)::int AS marked_good
    FROM leads l
    WHERE l.meta_ad_name IS NOT NULL ${timeFilter}
    GROUP BY l.meta_ad_name`);

  // Revenue AND the closed-deal count both come from listClosedQuotes — the
  // canonical grandTotalExVat (split/combined aware). Deriving revenue from
  // final_pricing would re-create the drift CLAUDE.md warns about.
  //
  // ⚠️ "Closed" is `closed_deal_at`, NOT `pipeline_stage='WON'`. Closing a deal
  // is deliberately decoupled from the pipeline stage, so counting WON leads
  // under-reports: דור אוריאלי is a real ₪8,793 deal sitting at CONSIDERATION
  // and was missing from this column until 2026-08-11.
  const revBySid = new Map<string, number>();
  const dealsBySid = new Map<string, number>();
  const dealNameBySid = new Map<string, string>();
  try {
    const { listClosedQuotes } = await import("@/lib/factory/server/closed");
    for (const d of await listClosedQuotes()) {
      const sid = (d.leadSid ?? "").trim();
      if (!sid) continue;
      revBySid.set(sid, (revBySid.get(sid) ?? 0) + (d.grandTotalExVat ?? 0));
      dealsBySid.set(sid, (dealsBySid.get(sid) ?? 0) + 1);
      const nm = (d.customerName ?? "").trim();
      if (nm && !dealNameBySid.has(sid)) dealNameBySid.set(sid, nm);
    }
  } catch (e) {
    console.warn("[ad-performance] closed-deal lookup failed (showing 0)", e);
  }
  // Which ad each revenue-carrying lead came from.
  const adBySid = new Map<string, string>();
  if (revBySid.size > 0) {
    const sidRows = await db.execute<{ sid: string; ad: string }>(sql`
      SELECT manychat_sub_id AS sid, meta_ad_name AS ad
      FROM leads WHERE meta_ad_name IS NOT NULL`);
    sidRows.rows.forEach((r) => adBySid.set(r.sid.trim(), r.ad));
  }

  // Names, so each ad shows WHO it actually brought — the deals it closed and
  // the leads Eli marked good. Far more actionable than a bare count.
  const dealNamesByAd = new Map<string, string[]>();
  for (const [sid] of dealsBySid) {
    const ad = adBySid.get(sid);
    if (!ad) continue;
    const nm = dealNameBySid.get(sid);
    if (!nm) continue;
    const list = dealNamesByAd.get(ad) ?? [];
    if (!list.includes(nm)) list.push(nm);
    dealNamesByAd.set(ad, list);
  }
  const goodNamesByAd = new Map<string, string[]>();
  {
    const gRows = await db.execute<{ ad: string; name: string | null }>(sql`
      SELECT meta_ad_name AS ad, name FROM leads
      WHERE meta_ad_name IS NOT NULL AND meta_qualified_sent_at IS NOT NULL`);
    for (const g of gRows.rows) {
      const nm = (g.name ?? "").trim();
      if (!nm) continue;
      const list = goodNamesByAd.get(g.ad) ?? [];
      if (!list.includes(nm)) list.push(nm);
      goodNamesByAd.set(g.ad, list);
    }
  }
  const revByAd = new Map<string, number>();
  const dealsByAd = new Map<string, number>();
  for (const [sid, rev] of revBySid) {
    const ad = adBySid.get(sid);
    if (ad) revByAd.set(ad, (revByAd.get(ad) ?? 0) + rev);
  }
  for (const [sid, n] of dealsBySid) {
    const ad = adBySid.get(sid);
    if (ad) dealsByAd.set(ad, (dealsByAd.get(ad) ?? 0) + n);
  }

  // Phase B: ad spend from Meta, joined by ad_id. Soft-fails to nulls so the
  // report still renders exactly as phase A when no token is configured.
  const spend = await fetchAdSpend(since ?? undefined);
  const hasSpend = spend.byAdId.size > 0;

  const rows: AdPerformanceRow[] = res.rows
    .map((r) => {
      const leads = Number(r.leads);
      const engaged = Number(r.engaged);
      const revenueIls = Math.round(revByAd.get(r.ad) ?? 0);
      const s = r.ad_id ? spend.byAdId.get(r.ad_id) : undefined;
      const spendIls = s ? Math.round(s.spendIls) : null;
      return {
        adName: r.ad,
        adId: r.ad_id,
        campaignName: r.campaign,
        leads,
        engaged,
        markedGood: Number(r.marked_good),
        won: dealsByAd.get(r.ad) ?? 0,
        revenueIls,
        dealCustomers: dealNamesByAd.get(r.ad) ?? [],
        goodLeadNames: goodNamesByAd.get(r.ad) ?? [],
        engagedPct: leads > 0 ? Math.round((100 * engaged) / leads) : 0,
        spendIls,
        costPerLeadIls:
          spendIls !== null && leads > 0 ? Math.round(spendIls / leads) : null,
        costPerQualityLeadIls:
          spendIls !== null && engaged > 0
            ? Math.round(spendIls / engaged)
            : null,
        roiIls: spendIls !== null ? revenueIls - spendIls : null,
      };
    })
    .sort(
      (a, b) =>
        b.revenueIls - a.revenueIls ||
        b.engaged - a.engaged ||
        b.leads - a.leads,
    );

  const unattrRes = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM leads l
    WHERE l.meta_ad_name IS NULL
      AND (l.source = 'facebook_import' OR l.lead_source = 'facebook') ${timeFilter}`);

  return {
    rows,
    totals: rows.reduce(
      (a, r) => ({
        leads: a.leads + r.leads,
        engaged: a.engaged + r.engaged,
        markedGood: a.markedGood + r.markedGood,
        won: a.won + r.won,
        revenueIls: a.revenueIls + r.revenueIls,
      }),
      { leads: 0, engaged: 0, markedGood: 0, won: 0, revenueIls: 0 },
    ),
    unattributed: Number(unattrRes.rows[0]?.n ?? 0),
    totalSpendIls: hasSpend ? Math.round(spend.totalSpendIls) : null,
    spendUnavailable: spend.unavailable,
  };
}
