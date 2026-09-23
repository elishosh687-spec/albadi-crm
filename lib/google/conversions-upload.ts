/**
 * The ONE place the CRM writes anything to Google: offline conversion events
 * through the Data Manager API (`events:ingest`). Plan phase 5, approved by
 * Eli 2026-09-23. `ads-read-only.test.ts` allows `datamanager.googleapis.com`
 * in this file only.
 *
 * Mode — env GOOGLE_CONVERSIONS_MODE:
 *   off       nothing is sent
 *   validate  (default) Google checks every event with validateOnly — nothing
 *             is counted, nothing is stamped as sent
 *   live      events are recorded in Google Ads and the lead is stamped
 *
 * Auth: its own refresh token, GOOGLE_DATAMANAGER_REFRESH_TOKEN, issued with
 * BOTH scopes (…/auth/datamanager + …/auth/adwords) — the Google Ads read
 * token cannot be reused (Google's rule). Same OAuth client as the read side.
 * Secrets never leave this module.
 */
import { accessToken, googleAdsConfig, type FetchFn } from "./ads-client";

const INGEST_URL = "https://datamanager.googleapis.com/v1/events:ingest";

export type ConversionsMode = "off" | "validate" | "live";

export function conversionsMode(env: Record<string, string | undefined> = process.env): ConversionsMode {
  const m = (env.GOOGLE_CONVERSIONS_MODE ?? "").trim().toLowerCase();
  return m === "off" || m === "live" ? m : "validate";
}

export function dataManagerConfig(env: Record<string, string | undefined> = process.env) {
  const base = googleAdsConfig(env);
  return {
    clientId: base.clientId,
    clientSecret: base.clientSecret,
    refreshToken: (env.GOOGLE_DATAMANAGER_REFRESH_TOKEN ?? "").trim(),
    customerId: base.customerId,
  };
}

export type IngestResult = { ok: true; requestId: string | null; warnings: string[] } | { ok: false; reason: string; configured: boolean };

/** Hebrew reason for a Data Manager error. Never echoes a secret. */
export function explainDataManagerError(status: number, body: any): string {
  const err = body?.error ?? {};
  const msg = String(err.message ?? "").slice(0, 220);
  const details = JSON.stringify(err.details ?? "");
  if (/ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient.*scope/i.test(details + msg)) {
    return "להרשאה אין את ה-scope של Data Manager — צריך להנפיק GOOGLE_DATAMANAGER_REFRESH_TOKEN עם datamanager + adwords";
  }
  if (/SERVICE_DISABLED|has not been used in project|is disabled/i.test(details + msg)) {
    return "ה-Data Manager API לא מופעל בפרויקט ה-Google Cloud של אפליקציית ה-OAuth";
  }
  if (status === 403) return `גוגל סירבה להעלאה (403)${msg ? `: ${msg}` : ""}`;
  if (status === 400) return `גוגל דחתה את ההמרות (400)${msg ? `: ${msg}` : ""}`;
  if (status === 429) return "גוגל הגבילה את קצב ההעלאה — ננסה שוב בריצה הבאה";
  return `Data Manager API החזירה ${status}${msg ? `: ${msg}` : ""}`;
}

export async function ingestEvents(body: object, opts: { fetchFn?: FetchFn; env?: Record<string, string | undefined> } = {}): Promise<IngestResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const cfg = dataManagerConfig(opts.env);
  if (!cfg.refreshToken || !cfg.clientId || !cfg.clientSecret) {
    return { ok: false, reason: "חסר GOOGLE_DATAMANAGER_REFRESH_TOKEN — עוד לא ניתנה הרשאת העלאה (Data Manager)", configured: false };
  }
  const tok = await accessToken(cfg, fetchFn, "GOOGLE_DATAMANAGER_REFRESH_TOKEN");
  if (!tok.ok) return { ok: false, reason: tok.reason, configured: true };
  let resp: Response;
  try {
    resp = await fetchFn(INGEST_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${tok.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (e) {
    const kind = e instanceof Error && e.name === "TimeoutError" ? "פג הזמן" : "שגיאת רשת";
    return { ok: false, reason: `לא הצלחתי להגיע ל-Data Manager API (${kind})`, configured: true };
  }
  const json: any = await resp.json().catch(() => null);
  if (!resp.ok) return { ok: false, reason: explainDataManagerError(resp.status, json), configured: true };
  const warnings = JSON.stringify(json ?? {}).match(/"(?:warning|message)"\s*:\s*"([^"]{1,200})"/g) ?? [];
  return { ok: true, requestId: json?.requestId ?? null, warnings: warnings.slice(0, 5) };
}
