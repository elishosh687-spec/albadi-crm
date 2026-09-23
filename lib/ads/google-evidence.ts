/**
 * Google Ads evidence — spend / clicks / conversions per campaign and ad group,
 * per day, read-only (GAQL via lib/google/ads-client.ts). The Google twin of
 * `meta-evidence.ts`, deliberately separate.
 *
 * Three reads: every non-removed campaign (so a campaign that never spent is
 * still listed with its status), campaign × day metrics from
 * GOOGLE_ADS_HISTORY_START (default 2026-08-01), and ad group × day (Search
 * only — PMax has no ad groups). Any failed read makes the WHOLE snapshot
 * unavailable: a partial history would show a confident wrong CPL.
 *
 * Money is ₪ (the account currency is ILS; checked 23/09).
 */
import { gaql, microsToIls, type FetchFn, type GoogleAdsConfig } from "@/lib/google/ads-client";

export interface GoogleDay {
  date: string;
  costIls: number;
  clicks: number;
  impressions: number;
  conversions: number;
}

export interface GoogleAdGroup {
  id: string;
  name: string;
  status: string | null;
  daily: GoogleDay[];
}

export interface GoogleCampaign {
  id: string;
  name: string;
  status: string | null;
  channel: string | null;
  daily: GoogleDay[];
  adGroups: Map<string, GoogleAdGroup>;
}

export type GoogleSnapshot =
  | { ok: true; campaigns: Map<string, GoogleCampaign>; fetchedAt: string; historyStart: string }
  | { ok: false; reason: string; configured: boolean; fetchedAt: string };

const num = (v: unknown) => Number(v ?? 0) || 0;
const day = (m: any, date: string): GoogleDay => ({
  date,
  costIls: microsToIls(m?.costMicros),
  clicks: num(m?.clicks),
  impressions: num(m?.impressions),
  conversions: num(m?.conversions),
});

/** Pure — builds the snapshot from the three row sets. Unit-tested. */
export function foldGoogleEvidence(campaignRows: any[], campaignDaily: any[], adGroupDaily: any[]): Map<string, GoogleCampaign> {
  const out = new Map<string, GoogleCampaign>();
  const ensure = (c: any) => {
    const id = String(c?.id ?? "");
    if (!id) return null;
    let e = out.get(id);
    if (!e) {
      e = { id, name: String(c?.name ?? id), status: c?.status ?? null, channel: c?.advertisingChannelType ?? null, daily: [], adGroups: new Map() };
      out.set(id, e);
    }
    return e;
  };
  for (const r of campaignRows) ensure(r.campaign);
  for (const r of campaignDaily) {
    const c = ensure(r.campaign);
    if (c && r.segments?.date) c.daily.push(day(r.metrics, r.segments.date));
  }
  for (const r of adGroupDaily) {
    const c = ensure(r.campaign);
    const agId = String(r.adGroup?.id ?? "");
    if (!c || !agId || !r.segments?.date) continue;
    let ag = c.adGroups.get(agId);
    if (!ag) {
      ag = { id: agId, name: String(r.adGroup?.name ?? agId), status: r.adGroup?.status ?? null, daily: [] };
      c.adGroups.set(agId, ag);
    }
    ag.daily.push(day(r.metrics, r.segments.date));
  }
  for (const c of out.values()) {
    c.daily.sort((a, b) => a.date.localeCompare(b.date));
    for (const ag of c.adGroups.values()) ag.daily.sort((a, b) => a.date.localeCompare(b.date));
  }
  return out;
}

/** Sum of the days on or after `since` (YYYY-MM-DD); all days when null. */
export function sumDays(days: GoogleDay[], since: string | null): Omit<GoogleDay, "date"> {
  return days
    .filter((d) => !since || d.date >= since)
    .reduce((a, d) => ({ costIls: a.costIls + d.costIls, clicks: a.clicks + d.clicks, impressions: a.impressions + d.impressions, conversions: a.conversions + d.conversions }), { costIls: 0, clicks: 0, impressions: 0, conversions: 0 });
}

let cache: { at: number; snap: GoogleSnapshot } | null = null;
const CACHE_MS = 10 * 60_000;

export async function fetchGoogleEvidence(
  opts: { fresh?: boolean; cfg?: GoogleAdsConfig; fetchFn?: FetchFn; today?: string; historyStart?: string } = {},
): Promise<GoogleSnapshot> {
  if (!opts.fresh && !opts.fetchFn && cache && Date.now() - cache.at < CACHE_MS) return cache.snap;
  const fetchedAt = new Date().toISOString();
  const historyStart = opts.historyStart ?? (process.env.GOOGLE_ADS_HISTORY_START ?? "2026-08-01").trim();
  const today = opts.today ?? fetchedAt.slice(0, 10);
  const q = (s: string) => gaql(s, { cfg: opts.cfg, fetchFn: opts.fetchFn });

  const [camps, cDaily, agDaily] = await Promise.all([
    q(`SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type FROM campaign WHERE campaign.status != 'REMOVED'`),
    q(`SELECT segments.date, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
         metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
       FROM campaign WHERE segments.date BETWEEN '${historyStart}' AND '${today}'`),
    q(`SELECT segments.date, campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group.status,
         metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions
       FROM ad_group WHERE segments.date BETWEEN '${historyStart}' AND '${today}'`),
  ]);
  for (const r of [camps, cDaily, agDaily]) {
    if (!r.ok) {
      const snap: GoogleSnapshot = { ok: false, reason: r.reason, configured: r.configured, fetchedAt };
      return snap;
    }
  }
  const snap: GoogleSnapshot = {
    ok: true,
    campaigns: foldGoogleEvidence((camps as any).rows, (cDaily as any).rows, (agDaily as any).rows),
    fetchedAt,
    historyStart,
  };
  if (!opts.fetchFn) cache = { at: Date.now(), snap };
  return snap;
}
