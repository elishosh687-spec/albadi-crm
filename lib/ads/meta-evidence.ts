/**
 * Meta evidence for the recommendation engine — read-only, by exact Ad ID.
 *
 * Two Graph reads with `META_ADS_TOKEN` (a System User token with `ads_read`;
 * no write permission is needed or wanted):
 *   1. Insights at `level=ad`, `time_increment=1` — one row per ad per day
 *      with spend and `actions`. Fetched in 90-day windows from
 *      `META_ADS_HISTORY_START` so a long history never trips Meta's "reduce
 *      the amount of data" limit, and every `paging.next` is followed — the
 *      older report read one page of 500 and would silently truncate.
 *   2. `/ads` — name, ad set, campaign and `effective_status` for every ad,
 *      including ones that never spent.
 *
 * Any failed request makes the WHOLE snapshot unavailable. Gates are decided
 * from cumulative spend, so a partial history would produce a wrong verdict
 * with full confidence; "no recommendation" is the honest answer.
 *
 * Leads = the `actions` entry with `action_type === "lead"` only. Summing the
 * array double-counts (`lead` + `onsite_conversion.lead_grouped` + …).
 *
 * The token never leaves this module: `paging.next` URLs embed it, so neither
 * a URL nor a raw fetch error is ever logged or returned.
 */
import { normalizeAdId } from "./ad-id";
import type { DailyRow } from "./recommendation-engine";

const GRAPH = "https://graph.facebook.com";
const WINDOW_DAYS = 90;
const MAX_PAGES = 200;

export interface MetaAd {
  adId: string;
  adName: string;
  adSetId: string | null;
  adSetName: string | null;
  campaignId: string | null;
  campaignName: string | null;
  effectiveStatus: string | null;
  daily: DailyRow[];
}

export type MetaSnapshot =
  | { ok: true; ads: Map<string, MetaAd>; fetchedAt: string; rows: number; pages: number }
  | { ok: false; reason: string; configured: boolean; fetchedAt: string };

export interface MetaConfig {
  token: string;
  accountId: string;
  version: string;
  historyStart: string;
}

export function metaEvidenceConfig(env: Record<string, string | undefined> = process.env): MetaConfig {
  const raw = (env.META_AD_ACCOUNT_ID ?? "1995170681032178").trim();
  return {
    token: (env.META_ADS_TOKEN ?? "").trim(),
    accountId: raw.startsWith("act_") ? raw : `act_${raw}`,
    version: (env.META_GRAPH_VERSION ?? "v26.0").trim(),
    historyStart: (env.META_ADS_HISTORY_START ?? "2026-01-01").trim(),
  };
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

/** Hebrew reason for a Graph error, never echoing the request URL. */
function explain(status: number, body: any): string {
  const err = body?.error ?? {};
  const code = Number(err.code);
  const msg = String(err.message ?? "").slice(0, 200);
  if (code === 190 || /expired|session has been invalidated/i.test(msg)) {
    return "הטוקן של מטא (META_ADS_TOKEN) פג או בוטל — צריך System User token חדש עם ads_read";
  }
  if (code === 10 || code === 200 || /permission/i.test(msg)) {
    return "לטוקן של מטא אין הרשאת ads_read לחשבון המודעות";
  }
  if (code === 4 || code === 17 || code === 32 || code === 613) {
    return "מטא הגבילה את קצב הבקשות — ננסה שוב בריצה הבאה";
  }
  return `מטא החזירה שגיאה ${status}${code ? ` (קוד ${code})` : ""}${msg ? `: ${msg}` : ""}`;
}

async function getAll(fetchFn: FetchFn, firstUrl: string): Promise<{ ok: true; data: any[]; pages: number } | { ok: false; reason: string }> {
  const data: any[] = [];
  let url: string | null = firstUrl;
  let pages = 0;
  while (url) {
    if (++pages > MAX_PAGES) return { ok: false, reason: `יותר מ-${MAX_PAGES} עמודים ממטא — עצרתי כדי לא להיתקע` };
    let resp: Response;
    try {
      resp = await fetchFn(url, { signal: AbortSignal.timeout(25_000) });
    } catch (e) {
      // Deliberately not the error text: some runtimes put the URL (and so the
      // token) into it.
      const kind = e instanceof Error && e.name === "TimeoutError" ? "פג הזמן" : "שגיאת רשת";
      return { ok: false, reason: `לא הצלחתי להגיע למטא (${kind})` };
    }
    const body: any = await resp.json().catch(() => null);
    if (!resp.ok || !body || body.error) return { ok: false, reason: explain(resp.status, body) };
    if (!Array.isArray(body.data)) return { ok: false, reason: "תשובה לא צפויה ממטא (אין data)" };
    data.push(...body.data);
    url = typeof body.paging?.next === "string" ? body.paging.next : null;
  }
  return { ok: true, data, pages };
}

/** Consecutive [since, until] windows of at most WINDOW_DAYS, inclusive. */
export function dateWindows(start: string, end: string): [string, string][] {
  const out: [string, string][] = [];
  const day = 86_400_000;
  let a = Date.parse(`${start}T00:00:00Z`);
  const last = Date.parse(`${end}T00:00:00Z`);
  while (a <= last) {
    const b = Math.min(a + (WINDOW_DAYS - 1) * day, last);
    out.push([new Date(a).toISOString().slice(0, 10), new Date(b).toISOString().slice(0, 10)]);
    a = b + day;
  }
  return out;
}

/** `lead` only — never the sum of the actions array. */
export function leadsFromActions(actions: unknown): number {
  if (!Array.isArray(actions)) return 0;
  const hit = actions.find((a: any) => a?.action_type === "lead");
  const n = Number(hit?.value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Fold insight rows + ad metadata into one entry per normalised Ad ID. */
export function foldMetaRows(insights: any[], ads: any[]): Map<string, MetaAd> {
  const out = new Map<string, MetaAd>();
  const ensure = (id: string, name: string) => {
    let a = out.get(id);
    if (!a) {
      a = { adId: id, adName: name, adSetId: null, adSetName: null, campaignId: null, campaignName: null, effectiveStatus: null, daily: [] };
      out.set(id, a);
    }
    return a;
  };
  for (const ad of ads) {
    const id = normalizeAdId(ad?.id);
    if (!id) continue;
    const a = ensure(id, String(ad.name ?? ""));
    a.adName = String(ad.name ?? a.adName);
    a.adSetId = normalizeAdId(ad.adset_id) ?? a.adSetId;
    a.adSetName = ad.adset?.name ?? a.adSetName;
    a.campaignId = normalizeAdId(ad.campaign_id) ?? a.campaignId;
    a.campaignName = ad.campaign?.name ?? a.campaignName;
    a.effectiveStatus = ad.effective_status ?? null;
  }
  for (const r of insights) {
    const id = normalizeAdId(r?.ad_id);
    if (!id) continue;
    const a = ensure(id, String(r.ad_name ?? ""));
    if (!a.adName) a.adName = String(r.ad_name ?? "");
    a.adSetId ??= normalizeAdId(r.adset_id);
    a.adSetName ??= r.adset_name ?? null;
    a.campaignId ??= normalizeAdId(r.campaign_id);
    a.campaignName ??= r.campaign_name ?? null;
    a.daily.push({
      date: String(r.date_start),
      spendIls: Number(r.spend ?? 0),
      metaLeads: leadsFromActions(r.actions),
    });
  }
  for (const a of out.values()) a.daily.sort((x, y) => x.date.localeCompare(y.date));
  return out;
}

let cache: { at: number; key: string; snap: MetaSnapshot } | null = null;
const TTL_MS = 10 * 60_000;

export async function fetchMetaEvidence(opts: {
  today: string;
  fresh?: boolean;
  config?: MetaConfig;
  fetchFn?: FetchFn;
}): Promise<MetaSnapshot> {
  const cfg = opts.config ?? metaEvidenceConfig();
  const fetchedAt = new Date().toISOString();
  if (!cfg.token) {
    return { ok: false, configured: false, fetchedAt, reason: "META_ADS_TOKEN לא מוגדר — אין נתוני הוצאה ממטא" };
  }
  const key = `${cfg.accountId}:${cfg.historyStart}:${opts.today}`;
  if (!opts.fresh && !opts.fetchFn && cache && cache.key === key && Date.now() - cache.at < TTL_MS) {
    return cache.snap;
  }
  const fetchFn = opts.fetchFn ?? ((u: string, i?: RequestInit) => fetch(u, i));
  const base = `${GRAPH}/${cfg.version}/${cfg.accountId}`;

  const insights: any[] = [];
  let pages = 0;
  for (const [since, until] of dateWindows(cfg.historyStart, opts.today)) {
    const u = new URL(`${base}/insights`);
    u.searchParams.set("level", "ad");
    u.searchParams.set("time_increment", "1");
    u.searchParams.set("time_range", JSON.stringify({ since, until }));
    u.searchParams.set("fields", "ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,actions");
    u.searchParams.set("limit", "500");
    u.searchParams.set("access_token", cfg.token);
    const r = await getAll(fetchFn, u.toString());
    if (!r.ok) return { ok: false, configured: true, fetchedAt, reason: r.reason };
    insights.push(...r.data);
    pages += r.pages;
  }

  const au = new URL(`${base}/ads`);
  au.searchParams.set("fields", "id,name,adset_id,adset{name},campaign_id,campaign{name},effective_status");
  au.searchParams.set("limit", "500");
  au.searchParams.set("access_token", cfg.token);
  const ads = await getAll(fetchFn, au.toString());
  if (!ads.ok) return { ok: false, configured: true, fetchedAt, reason: ads.reason };
  pages += ads.pages;

  const snap: MetaSnapshot = { ok: true, ads: foldMetaRows(insights, ads.data), fetchedAt, rows: insights.length, pages };
  if (!opts.fetchFn) cache = { at: Date.now(), key, snap };
  return snap;
}
