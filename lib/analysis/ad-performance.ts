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

export interface AdPerformanceRow {
  adName: string;
  campaignName: string | null;
  leads: number;
  /** Reached an engaged pipeline stage (DISCAVERY / FACTORY_WAIT / CONSIDERATION / WON). */
  engaged: number;
  /** Eli marked it "good lead" in GHL (reported to Meta). */
  markedGood: number;
  won: number;
  /** Sum of closed-deal customer totals (ex-VAT) attributed to this ad. */
  revenueIls: number;
  /** engaged / leads, 0..100. */
  engagedPct: number;
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
    campaign: string | null;
    leads: number;
    engaged: number;
    marked_good: number;
    won: number;
  }>(sql`
    SELECT l.meta_ad_name AS ad,
           MAX(l.meta_campaign_name) AS campaign,
           count(*)::int AS leads,
           count(*) FILTER (WHERE ${ENGAGED})::int AS engaged,
           count(*) FILTER (WHERE l.meta_qualified_sent_at IS NOT NULL)::int AS marked_good,
           count(*) FILTER (WHERE l.pipeline_stage = 'WON')::int AS won
    FROM leads l
    WHERE l.meta_ad_name IS NOT NULL ${timeFilter}
    GROUP BY l.meta_ad_name`);

  // Revenue comes from listClosedQuotes' canonical grandTotalExVat — the ONE
  // customer total (split/combined aware). Deriving it from final_pricing here
  // would re-create the very drift CLAUDE.md warns about (totalSellingPrice is
  // the unrounded engine figure, not what the customer was billed).
  const revBySid = new Map<string, number>();
  try {
    const { listClosedQuotes } = await import("@/lib/factory/server/closed");
    for (const d of await listClosedQuotes()) {
      const sid = (d.leadSid ?? "").trim();
      if (!sid) continue;
      revBySid.set(sid, (revBySid.get(sid) ?? 0) + (d.grandTotalExVat ?? 0));
    }
  } catch (e) {
    console.warn("[ad-performance] revenue lookup failed (showing 0)", e);
  }
  // Which ad each revenue-carrying lead came from.
  const adBySid = new Map<string, string>();
  if (revBySid.size > 0) {
    const sidRows = await db.execute<{ sid: string; ad: string }>(sql`
      SELECT manychat_sub_id AS sid, meta_ad_name AS ad
      FROM leads WHERE meta_ad_name IS NOT NULL`);
    sidRows.rows.forEach((r) => adBySid.set(r.sid.trim(), r.ad));
  }
  const revByAd = new Map<string, number>();
  for (const [sid, rev] of revBySid) {
    const ad = adBySid.get(sid);
    if (ad) revByAd.set(ad, (revByAd.get(ad) ?? 0) + rev);
  }

  const rows: AdPerformanceRow[] = res.rows
    .map((r) => ({
      adName: r.ad,
      campaignName: r.campaign,
      leads: Number(r.leads),
      engaged: Number(r.engaged),
      markedGood: Number(r.marked_good),
      won: Number(r.won),
      revenueIls: Math.round(revByAd.get(r.ad) ?? 0),
      engagedPct:
        Number(r.leads) > 0
          ? Math.round((100 * Number(r.engaged)) / Number(r.leads))
          : 0,
    }))
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
  };
}
