/**
 * Google Ads API — READ ONLY. The one place the CRM talks to Google Ads.
 *
 * REST `googleAds:searchStream` with an OAuth refresh token; no SDK (the
 * official client is gRPC/Node-heavy and we only ever run GAQL SELECTs).
 * There is no mutate call here and `tests/unit/architecture/ads-read-only.test.ts`
 * fails the build if one appears — Google's OAuth scope cannot be read-only,
 * so the guard lives in code.
 *
 * Credentials (Vercel env, 2026-09-23 — the same ones the marketing repo uses,
 * Eli's call): GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_CLIENT_ID,
 * GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN, GOOGLE_ADS_CUSTOMER_ID
 * (Albadi 6763920913). The Albadi account is called WITHOUT a
 * login-customer-id header: the marketing repo's MCC does not manage it.
 *
 * Secrets never leave this module: no token, URL-with-token or raw fetch error
 * is logged or returned — only a Hebrew reason.
 *
 * Plan: docs/plans/2026-09-23-google-ads-tab-design.md (phase 2).
 */

const OAUTH_URL = "https://oauth2.googleapis.com/token";
const API = "https://googleads.googleapis.com";

export interface GoogleAdsConfig {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  customerId: string;
  version: string;
}

export function googleAdsConfig(env: Record<string, string | undefined> = process.env): GoogleAdsConfig {
  const t = (k: string) => (env[k] ?? "").trim();
  return {
    developerToken: t("GOOGLE_ADS_DEVELOPER_TOKEN"),
    clientId: t("GOOGLE_ADS_CLIENT_ID"),
    clientSecret: t("GOOGLE_ADS_CLIENT_SECRET"),
    refreshToken: t("GOOGLE_ADS_REFRESH_TOKEN"),
    customerId: (t("GOOGLE_ADS_CUSTOMER_ID") || "6763920913").replace(/-/g, ""),
    version: t("GOOGLE_ADS_API_VERSION") || "v24",
  };
}

/** Names of the missing env vars — empty when configured. */
export function missingConfig(cfg: GoogleAdsConfig): string[] {
  const out: string[] = [];
  if (!cfg.developerToken) out.push("GOOGLE_ADS_DEVELOPER_TOKEN");
  if (!cfg.clientId) out.push("GOOGLE_ADS_CLIENT_ID");
  if (!cfg.clientSecret) out.push("GOOGLE_ADS_CLIENT_SECRET");
  if (!cfg.refreshToken) out.push("GOOGLE_ADS_REFRESH_TOKEN");
  return out;
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export type GaqlResult =
  | { ok: true; rows: any[] }
  | { ok: false; reason: string; configured: boolean };

let cachedToken: { value: string; expiresAt: number; key: string } | null = null;

/** Test hook — forget the cached access token. */
export function _resetTokenCache() {
  cachedToken = null;
}

async function accessToken(cfg: GoogleAdsConfig, fetchFn: FetchFn): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
  const key = `${cfg.clientId}:${cfg.refreshToken.slice(-6)}`;
  if (cachedToken && cachedToken.key === key && cachedToken.expiresAt > Date.now() + 60_000) {
    return { ok: true, token: cachedToken.value };
  }
  let resp: Response;
  try {
    resp = await fetchFn(OAUTH_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: cfg.refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, reason: "לא הצלחתי להגיע לגוגל לחידוש ההרשאה (שגיאת רשת)" };
  }
  const body: any = await resp.json().catch(() => null);
  if (!resp.ok || !body?.access_token) {
    const err = String(body?.error ?? "");
    if (err === "invalid_grant") {
      return { ok: false, reason: "ההרשאה ל-Google Ads (GOOGLE_ADS_REFRESH_TOKEN) פגה או בוטלה — צריך להנפיק refresh token חדש" };
    }
    if (err === "invalid_client") return { ok: false, reason: "פרטי אפליקציית ה-OAuth של גוגל לא תקינים (GOOGLE_ADS_CLIENT_ID/SECRET)" };
    return { ok: false, reason: `גוגל דחתה את חידוש ההרשאה (${resp.status}${err ? `, ${err}` : ""})` };
  }
  cachedToken = { value: body.access_token, expiresAt: Date.now() + Number(body.expires_in ?? 3000) * 1000, key };
  return { ok: true, token: body.access_token };
}

/** Hebrew reason for a Google Ads API error body. Never echoes a secret. */
export function explainGoogleError(status: number, body: any): string {
  const err = Array.isArray(body) ? body[0]?.error : body?.error;
  const details = JSON.stringify(err?.details ?? "");
  // The top-level message is generic ("Request contains an invalid argument");
  // Google's real reason sits in details[].errors[].message.
  const detailMsg = (err?.details ?? []).flatMap((d: any) => d?.errors ?? []).map((e: any) => e?.message).find(Boolean);
  const msg = String(detailMsg ?? err?.message ?? "").slice(0, 200);
  if (/DEVELOPER_TOKEN_NOT_APPROVED|DEVELOPER_TOKEN_PROHIBITED|DEVELOPER_TOKEN_INVALID/.test(details)) {
    return "ה-developer token של Google Ads לא מאושר לחשבון הזה";
  }
  if (/USER_PERMISSION_DENIED|CUSTOMER_NOT_ENABLED|NOT_ADS_USER/.test(details) || status === 403) {
    return "למשתמש של ההרשאה אין גישה לחשבון Google Ads של אלבדי";
  }
  if (/QUERY_ERROR|INVALID_ARGUMENT/.test(details) || status === 400) {
    return `שאילתה לא תקינה ל-Google Ads${msg ? `: ${msg}` : ""}`;
  }
  if (status === 429 || /RESOURCE_EXHAUSTED/.test(details)) return "גוגל הגבילה את קצב הבקשות — ננסה שוב בריצה הבאה";
  if (status === 401) return "גוגל דחתה את ההרשאה (401) — ייתכן שה-refresh token בוטל";
  return `Google Ads החזירה שגיאה ${status}${msg ? `: ${msg}` : ""}`;
}

/**
 * Run one GAQL SELECT and return every row (searchStream returns all batches
 * in one response). Rows are the raw camelCase JSON objects.
 */
export async function gaql(
  query: string,
  opts: { cfg?: GoogleAdsConfig; fetchFn?: FetchFn } = {},
): Promise<GaqlResult> {
  const cfg = opts.cfg ?? googleAdsConfig();
  const fetchFn = opts.fetchFn ?? fetch;
  if (!/^\s*SELECT\s/i.test(query)) return { ok: false, reason: "רק שאילתות SELECT מותרות מול Google Ads", configured: true };
  const missing = missingConfig(cfg);
  if (missing.length) return { ok: false, reason: `חסרים משתני סביבה: ${missing.join(", ")}`, configured: false };

  const tok = await accessToken(cfg, fetchFn);
  if (!tok.ok) return { ok: false, reason: tok.reason, configured: true };

  let resp: Response;
  try {
    resp = await fetchFn(`${API}/${cfg.version}/customers/${cfg.customerId}/googleAds:searchStream`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${tok.token}`,
        "developer-token": cfg.developerToken,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (e) {
    const kind = e instanceof Error && e.name === "TimeoutError" ? "פג הזמן" : "שגיאת רשת";
    return { ok: false, reason: `לא הצלחתי להגיע ל-Google Ads (${kind})`, configured: true };
  }
  const body: any = await resp.json().catch(() => null);
  if (!resp.ok || !Array.isArray(body)) {
    return { ok: false, reason: explainGoogleError(resp.status, body), configured: true };
  }
  return { ok: true, rows: body.flatMap((batch: any) => batch?.results ?? []) };
}

/** Google money is in micros of the account currency (ILS for Albadi). */
export const microsToIls = (micros: string | number | null | undefined) => Number(micros ?? 0) / 1_000_000;
