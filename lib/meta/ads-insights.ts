/**
 * Meta Ads spend, per ad — the COST side of the ad-quality report.
 *
 * Phase A answered "which ad brings quality leads" from our own DB. This adds
 * what each ad COST, so the "מודעות" tab can show cost-per-lead,
 * cost-per-quality-lead and true ROI instead of revenue in a vacuum.
 *
 * Reads the Graph API Insights endpoint at `level=ad`. Joined to our leads by
 * **ad_id** (`leads.meta_ad_id`), never by name — names get edited and
 * duplicated, ids don't.
 *
 * Auth: `META_ADS_TOKEN`. A normal user token expires in ~1 hour, so for the
 * cron/report to keep working this must be a **System User token** (Business
 * Settings → System Users → Generate token, with `ads_read`). Without it every
 * function here soft-fails to "no spend data" and the tab still renders phase A.
 *
 * See memory meta-conversion-loop and /Users/eli/Projects/meta/README.md.
 */

const GRAPH = "https://graph.facebook.com";

export interface AdSpendRow {
  adId: string;
  adName: string;
  spendIls: number;
  impressions: number;
  clicks: number;
}

export interface AdSpendSnapshot {
  /** ad_id → spend row. */
  byAdId: Map<string, AdSpendRow>;
  totalSpendIls: number;
  currency: string | null;
  /** Null when everything is fine; a human-readable reason when we have no data. */
  unavailable: string | null;
}

const EMPTY = (reason: string): AdSpendSnapshot => ({
  byAdId: new Map(),
  totalSpendIls: 0,
  currency: null,
  unavailable: reason,
});

function config() {
  const token = (process.env.META_ADS_TOKEN ?? "").trim();
  // Albadi's ad account (seen in the Ads Manager URL: act=1995170681032178).
  const raw = (process.env.META_AD_ACCOUNT_ID ?? "1995170681032178").trim();
  const accountId = raw.startsWith("act_") ? raw : `act_${raw}`;
  const version = (process.env.META_GRAPH_VERSION ?? "v26.0").trim();
  return { token, accountId, version };
}

export function metaAdsConfigured(): boolean {
  return Boolean(config().token);
}

/** Cheap in-process cache — the tab is opened occasionally, Meta rate-limits. */
let cache: { at: number; key: string; snap: AdSpendSnapshot } | null = null;
const TTL_MS = 10 * 60_000;

/**
 * Spend per ad for a period. `sinceDays` undefined → Meta's `maximum` preset
 * (matches the tab's "הכל").
 */
export async function fetchAdSpend(
  sinceDays?: number,
): Promise<AdSpendSnapshot> {
  const { token, accountId, version } = config();
  if (!token) return EMPTY("META_ADS_TOKEN not set");

  const preset =
    sinceDays === 30 ? "last_30d" : sinceDays === 90 ? "last_90d" : "maximum";
  const key = `${accountId}:${preset}`;
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) {
    return cache.snap;
  }

  const url = new URL(`${GRAPH}/${version}/${accountId}/insights`);
  url.searchParams.set("level", "ad");
  url.searchParams.set("fields", "ad_id,ad_name,spend,impressions,clicks");
  url.searchParams.set("date_preset", preset);
  url.searchParams.set("limit", "500");
  url.searchParams.set("access_token", token);

  try {
    const resp = await fetch(url.toString());
    const json: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = json?.error?.message ?? `HTTP ${resp.status}`;
      // The #1 real-world failure: a user token that expired.
      const hint = /expired|session|OAuth/i.test(String(msg))
        ? " — נראה שהטוקן פג. צריך System User token (לא פג)."
        : "";
      return EMPTY(`Meta: ${msg}${hint}`);
    }
    const rows: AdSpendRow[] = (json.data ?? []).map((d: any) => ({
      adId: String(d.ad_id ?? ""),
      adName: String(d.ad_name ?? ""),
      spendIls: Number(d.spend ?? 0),
      impressions: Number(d.impressions ?? 0),
      clicks: Number(d.clicks ?? 0),
    }));
    const byAdId = new Map<string, AdSpendRow>();
    for (const r of rows) if (r.adId) byAdId.set(r.adId, r);
    const snap: AdSpendSnapshot = {
      byAdId,
      totalSpendIls: rows.reduce((s, r) => s + r.spendIls, 0),
      // Insights returns spend in the ad account's currency (ILS here).
      currency: "ILS",
      unavailable: rows.length === 0 ? "אין נתוני עלות לתקופה" : null,
    };
    cache = { at: Date.now(), key, snap };
    return snap;
  } catch (e) {
    return EMPTY(`fetch failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
