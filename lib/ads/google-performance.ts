/**
 * "מודעות ← גוגל ← קמפיינים" — what each Google campaign brought in the CRM,
 * next to what Google charged for it. The Google twin of
 * `lib/analysis/ad-performance.ts`, deliberately separate.
 *
 * A Google lead = `lead_source = 'google'`, or a Google click id on the lead,
 * or a campaign filled by the attribution job, or (setting) a WhatsApp lead
 * whose prefill said "הגעתי מגוגל" (source_touches `landing_google`).
 * Suitable = the Google settings' GHL tag in `lead_tags`. Deals + revenue =
 * `listClosedQuotes()` (the canonical rule), joined by lead sid.
 *
 * Spend comes from the Google snapshot; when it is unavailable spend is
 * UNKNOWN (null → "—"), never ₪0.
 *
 * The pure fold (`foldGooglePerformance`) is unit-tested; `buildGooglePerformance`
 * does the reads.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { sumDays, type GoogleCampaign, type GoogleSnapshot } from "./google-evidence";
import type { GoogleAdsSettings } from "./google-settings";

export interface GoogleLeadRow {
  sid: string;
  name: string | null;
  campaignId: string | null;
  campaignName: string | null;
  adGroupId: string | null;
  adGroupName: string | null;
  keyword: string | null;
  matchType: string | null;
  attribution: string | null;
  suitable: boolean;
  engaged: boolean;
  viaWhatsApp: boolean;
}

export interface GoogleDealRow {
  sid: string;
  customerName: string | null;
  totalExVat: number;
}

export interface GoogleMoney {
  spendIls: number | null;
  clicks: number | null;
  googleConversions: number | null;
}

export interface GoogleAdGroupRow extends GoogleMoney {
  id: string;
  name: string;
  leads: number;
  suitable: number;
  won: number;
  revenueIls: number;
}

export interface GoogleKeywordRow {
  text: string;
  matchType: string | null;
  leads: number;
  suitable: number;
  won: number;
}

export interface GoogleCampaignRow extends GoogleMoney {
  id: string;
  name: string;
  status: string | null;
  channel: string | null;
  leads: number;
  engaged: number;
  suitable: number;
  won: number;
  revenueIls: number;
  dealCustomers: string[];
  suitableNames: string[];
  cplIls: number | null;
  cacIls: number | null;
  profitAfterAdsIls: number | null;
  adGroups: GoogleAdGroupRow[];
  keywords: GoogleKeywordRow[];
  /** Brought a deal, revenue or a suitable lead. */
  leading: boolean;
}

export interface GooglePerformanceReport {
  rows: GoogleCampaignRow[];
  totals: { leads: number; suitable: number; won: number; revenueIls: number; spendIls: number | null; clicks: number | null };
  /** Google leads without a campaign (WhatsApp prefill, not yet / not found). */
  unattributed: { total: number; whatsapp: number; notFound: number; pending: number };
  spendUnavailable: string | null;
  since: string | null;
}

const round = (n: number) => Math.round(n);

export function foldGooglePerformance(
  leads: GoogleLeadRow[],
  deals: GoogleDealRow[],
  snapshot: GoogleSnapshot | null,
  settings: GoogleAdsSettings,
  since: string | null,
): GooglePerformanceReport {
  const campaigns: Map<string, GoogleCampaign> = snapshot?.ok ? snapshot.campaigns : new Map();
  const spendKnown = Boolean(snapshot?.ok);

  const dealsBySid = new Map<string, GoogleDealRow[]>();
  for (const d of deals) {
    const k = d.sid.trim();
    dealsBySid.set(k, [...(dealsBySid.get(k) ?? []), d]);
  }

  type Acc = {
    id: string; name: string; leads: number; engaged: number; suitable: number; won: number; revenue: number;
    dealCustomers: string[]; suitableNames: string[];
    adGroups: Map<string, { name: string; leads: number; suitable: number; won: number; revenue: number }>;
    keywords: Map<string, GoogleKeywordRow>;
  };
  const acc = new Map<string, Acc>();
  const unattributed = { total: 0, whatsapp: 0, notFound: 0, pending: 0 };

  for (const l of leads) {
    const ds = dealsBySid.get(l.sid.trim()) ?? [];
    if (!l.campaignId) {
      unattributed.total++;
      if (l.viaWhatsApp) unattributed.whatsapp++;
      else if (l.attribution === "not_found") unattributed.notFound++;
      else unattributed.pending++;
      continue;
    }
    let a = acc.get(l.campaignId);
    if (!a) {
      a = { id: l.campaignId, name: l.campaignName ?? l.campaignId, leads: 0, engaged: 0, suitable: 0, won: 0, revenue: 0, dealCustomers: [], suitableNames: [], adGroups: new Map(), keywords: new Map() };
      acc.set(l.campaignId, a);
    }
    const revenue = ds.reduce((s, d) => s + d.totalExVat, 0);
    a.leads++;
    if (l.engaged) a.engaged++;
    if (l.suitable) {
      a.suitable++;
      const nm = (l.name ?? "").split("|")[0].trim();
      if (nm && !a.suitableNames.includes(nm)) a.suitableNames.push(nm);
    }
    a.won += ds.length;
    a.revenue += revenue;
    for (const d of ds) {
      const nm = (d.customerName ?? "").trim();
      if (nm && !a.dealCustomers.includes(nm)) a.dealCustomers.push(nm);
    }
    if (l.adGroupId) {
      const g = a.adGroups.get(l.adGroupId) ?? { name: l.adGroupName ?? l.adGroupId, leads: 0, suitable: 0, won: 0, revenue: 0 };
      g.leads++;
      if (l.suitable) g.suitable++;
      g.won += ds.length;
      g.revenue += revenue;
      a.adGroups.set(l.adGroupId, g);
    }
    if (l.keyword) {
      const key = `${l.keyword}|${l.matchType ?? ""}`;
      const k = a.keywords.get(key) ?? { text: l.keyword, matchType: l.matchType, leads: 0, suitable: 0, won: 0 };
      k.leads++;
      if (l.suitable) k.suitable++;
      k.won += ds.length;
      a.keywords.set(key, k);
    }
  }

  // Every campaign Google knows (so spend without leads shows) + every campaign leads name.
  const ids = new Set<string>([...campaigns.keys(), ...acc.keys()]);
  const rows: GoogleCampaignRow[] = [];
  for (const id of ids) {
    const c = campaigns.get(id);
    const a = acc.get(id);
    const money = c ? sumDays(c.daily, since) : null;
    const spendIls = spendKnown ? round(money?.costIls ?? 0) : null;
    // A campaign Google lists that neither spent in the period nor brought a lead is noise.
    if (!a && (spendIls === null || spendIls === 0) && (money?.clicks ?? 0) === 0) continue;
    const leadsN = a?.leads ?? 0;
    const won = a?.won ?? 0;
    const adGroupIds = new Set<string>([...(c ? c.adGroups.keys() : []), ...(a ? a.adGroups.keys() : [])]);
    const adGroups: GoogleAdGroupRow[] = [...adGroupIds]
      .map((agId) => {
        const g = c?.adGroups.get(agId);
        const m = g ? sumDays(g.daily, since) : null;
        const x = a?.adGroups.get(agId);
        return {
          id: agId,
          name: x?.name ?? g?.name ?? agId,
          spendIls: spendKnown ? round(m?.costIls ?? 0) : null,
          clicks: spendKnown ? (m?.clicks ?? 0) : null,
          googleConversions: spendKnown ? (m?.conversions ?? 0) : null,
          leads: x?.leads ?? 0,
          suitable: x?.suitable ?? 0,
          won: x?.won ?? 0,
          revenueIls: round(x?.revenue ?? 0),
        };
      })
      .filter((g) => g.leads > 0 || (g.spendIls ?? 0) > 0 || (g.clicks ?? 0) > 0)
      .sort((p, q) => q.revenueIls - p.revenueIls || q.leads - p.leads || (q.spendIls ?? 0) - (p.spendIls ?? 0));
    const keywords = [...(a?.keywords.values() ?? [])].sort((p, q) => q.won - p.won || q.suitable - p.suitable || q.leads - p.leads).slice(0, 5);
    rows.push({
      id,
      name: a?.name && a.name !== id ? a.name : c?.name ?? a?.name ?? id,
      status: c?.status ?? null,
      channel: c?.channel ?? null,
      spendIls,
      clicks: spendKnown ? (money?.clicks ?? 0) : null,
      googleConversions: spendKnown ? (money?.conversions ?? 0) : null,
      leads: leadsN,
      engaged: a?.engaged ?? 0,
      suitable: a?.suitable ?? 0,
      won,
      revenueIls: round(a?.revenue ?? 0),
      dealCustomers: a?.dealCustomers ?? [],
      suitableNames: a?.suitableNames ?? [],
      cplIls: spendIls !== null && leadsN > 0 ? Math.round((spendIls / leadsN) * 100) / 100 : null,
      cacIls: spendIls !== null && won > 0 ? round(spendIls / won) : null,
      profitAfterAdsIls: spendIls !== null ? round(won * settings.economics.contributionProfitIls - spendIls) : null,
      adGroups,
      keywords,
      leading: won > 0 || (a?.revenue ?? 0) > 0 || (a?.suitable ?? 0) > 0,
    });
  }
  rows.sort((p, q) => q.revenueIls - p.revenueIls || q.won - p.won || q.leads - p.leads || (q.spendIls ?? 0) - (p.spendIls ?? 0));

  const totalLeads = leads.length;
  const totalSuitable = leads.filter((l) => l.suitable).length;
  let totalWon = 0;
  let totalRevenue = 0;
  for (const l of leads) {
    const ds = dealsBySid.get(l.sid.trim()) ?? [];
    totalWon += ds.length;
    totalRevenue += ds.reduce((s, d) => s + d.totalExVat, 0);
  }
  let spend: number | null = null;
  let clicks: number | null = null;
  if (spendKnown) {
    spend = 0;
    clicks = 0;
    for (const c of campaigns.values()) {
      const m = sumDays(c.daily, since);
      spend += m.costIls;
      clicks += m.clicks;
    }
    spend = round(spend);
  }
  return {
    rows,
    totals: { leads: totalLeads, suitable: totalSuitable, won: totalWon, revenueIls: round(totalRevenue), spendIls: spend, clicks },
    unattributed,
    spendUnavailable: snapshot && !snapshot.ok ? snapshot.reason : null,
    since,
  };
}

const ENGAGED = sql`l.pipeline_stage IN ('DISCAVERY','FACTORY_WAIT','CONSIDERATION','WON')`;

/** Israel-day string N days back, or null for "all". */
export function sinceDate(days: number | undefined, now = new Date()): string | null {
  if (!days || days <= 0) return null;
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

export async function loadGoogleLeads(settings: GoogleAdsSettings, since: string | null): Promise<GoogleLeadRow[]> {
  const wa = settings.measurement.countWhatsAppPrefill
    ? sql`OR EXISTS (SELECT 1 FROM source_touches st WHERE st.manychat_sub_id = l.manychat_sub_id AND st.source_detail_1 = 'landing_google')`
    : sql``;
  const time = since ? sql`AND l.created_at >= ${since}::date` : sql``;
  const res = await db.execute<{
    sid: string; name: string | null; campaign_id: string | null; campaign_name: string | null;
    ad_group_id: string | null; ad_group_name: string | null; keyword: string | null; match_type: string | null;
    attribution: string | null; suitable: boolean; engaged: boolean; has_click: boolean;
  }>(sql`
    SELECT l.manychat_sub_id AS sid, l.name, l.google_campaign_id AS campaign_id, l.google_campaign_name AS campaign_name,
           l.google_ad_group_id AS ad_group_id, l.google_ad_group_name AS ad_group_name,
           l.google_keyword AS keyword, l.google_match_type AS match_type, l.google_attribution AS attribution,
           EXISTS (SELECT 1 FROM lead_tags t WHERE t.manychat_sub_id = l.manychat_sub_id
                   AND lower(btrim(t.tag)) = lower(btrim(${settings.suitableLead.tag}))) AS suitable,
           (${ENGAGED}) AS engaged,
           (l.google_gclid IS NOT NULL OR l.google_gbraid IS NOT NULL OR l.google_wbraid IS NOT NULL) AS has_click
    FROM leads l
    WHERE l.manychat_sub_id NOT LIKE 'test:%'
      AND (l.lead_source = 'google' OR l.google_gclid IS NOT NULL OR l.google_gbraid IS NOT NULL
           OR l.google_wbraid IS NOT NULL OR l.google_campaign_id IS NOT NULL ${wa})
      ${time}`);
  return res.rows.map((r) => ({
    sid: r.sid,
    name: r.name,
    campaignId: r.campaign_id,
    campaignName: r.campaign_name,
    adGroupId: r.ad_group_id,
    adGroupName: r.ad_group_name,
    keyword: r.keyword,
    matchType: r.match_type,
    attribution: r.attribution,
    suitable: Boolean(r.suitable),
    engaged: Boolean(r.engaged),
    viaWhatsApp: !r.has_click && !r.campaign_id,
  }));
}

export async function buildGooglePerformance(opts: { sinceDays?: number; fresh?: boolean } = {}): Promise<GooglePerformanceReport> {
  const [{ getGooglePolicy }, { fetchGoogleEvidence }, { listClosedQuotes }] = await Promise.all([
    import("./google-settings-store"),
    import("./google-evidence"),
    import("@/lib/factory/server/closed"),
  ]);
  const policy = await getGooglePolicy();
  const since = sinceDate(opts.sinceDays);
  const [leads, snapshot, closed] = await Promise.all([
    loadGoogleLeads(policy.settings, since),
    fetchGoogleEvidence({ fresh: opts.fresh }),
    listClosedQuotes(),
  ]);
  const deals: GoogleDealRow[] = closed
    .filter((d) => (d.leadSid ?? "").trim())
    .map((d) => ({ sid: d.leadSid!.trim(), customerName: d.customerName ?? null, totalExVat: d.grandTotalExVat ?? 0 }));
  return foldGooglePerformance(leads, deals, snapshot, policy.settings, since);
}
