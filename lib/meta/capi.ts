/**
 * Meta Conversions API for CRM — the OUTBOUND side of the conversion loop.
 * Sends "this lead progressed / became a deal" events back to Meta, keyed by the
 * Meta leadgen id, so the ad algorithm optimizes for quality leads. See memory
 * meta-conversion-loop.
 *
 * Inbound (how leads get the leadgen id) = lib/sheets/meta-attribution.ts.
 *
 * Soft-fails everywhere: missing env / missing leadgen id → no-op (never throws
 * into the caller's flow). A lead with no meta_leadgen_id simply isn't reported.
 */
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export type MetaEventName = "Qualified" | "QuoteSent" | "Purchase";

export interface MetaSendOpts {
  /** Deal/customer value ex-VAT, in ILS. Included in custom_data for Purchase. */
  valueIls?: number | null;
  /** Unix seconds; defaults to now. */
  eventTime?: number;
  /** Meta Test Events code — routes to the Test Events tab, not live optimization. */
  testEventCode?: string | null;
  /** Overrides event_id (dedup key). Defaults to `<sid>:<eventName>`. */
  eventId?: string;
  /**
   * Build the payload and return it WITHOUT sending. The only way to answer
   * "which parameters are we actually sending Meta?" without reading it back
   * out of Events Manager, which reports its own view and started this
   * argument in the first place.
   */
  preview?: boolean;
}

export interface MetaSendResult {
  ok: boolean;
  skipped?: string; // reason when not sent
  eventsReceived?: number;
  fbtraceId?: string;
  error?: string;
  /** Populated only when `preview` is set — the exact event we would POST. */
  payload?: Record<string, unknown>;
  /** Which user_data matching keys are present, for a quick eyeball. */
  matchKeys?: string[];
}

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

/** Meta wants email lowercased+trimmed, phone as digits-only (country code, no +). */
const normEmail = (e: string) => e.trim().toLowerCase();
const normPhone = (p: string) => p.replace(/[^0-9]/g, "");

function config() {
  const token = (process.env.META_CAPI_TOKEN ?? "").trim();
  const datasetId = (process.env.META_DATASET_ID ?? "").trim();
  const version = (process.env.META_GRAPH_VERSION ?? "v26.0").trim();
  return { token, datasetId, version };
}

export function metaCapiConfigured(): boolean {
  const { token, datasetId } = config();
  return Boolean(token && datasetId);
}

export interface MetaPingResult {
  ok: boolean;
  /** The dataset's own name as Meta reports it — proof we reached THIS dataset. */
  datasetName?: string;
  error?: string;
  /** True when Meta rejected the credentials (expired/revoked token). */
  authFailed?: boolean;
}

/**
 * Actually talk to Meta.
 *
 * `metaCapiConfigured()` only proves two env vars are non-empty, so a health
 * check built on it stays green through an expired or revoked token — the
 * exact failure it exists to catch. This reads the dataset back over the Graph
 * API: it needs the token to be valid AND to have access to that dataset, and
 * it sends no events, so it can run on every page load without polluting data.
 */
export async function pingMetaDataset(): Promise<MetaPingResult> {
  const { token, datasetId, version } = config();
  if (!token || !datasetId) {
    return { ok: false, error: "חסר META_CAPI_TOKEN או META_DATASET_ID" };
  }
  const url = `https://graph.facebook.com/${version}/${datasetId}?fields=name&access_token=${encodeURIComponent(token)}`;
  try {
    // Bounded: a slow Meta must not hang the ads page behind it.
    const resp = await fetch(url, { signal: AbortSignal.timeout(6000), cache: "no-store" });
    const json: {
      name?: string;
      error?: { message?: string; code?: number };
    } = await resp.json().catch(() => ({}));
    if (!resp.ok || json.error) {
      const code = json.error?.code;
      return {
        ok: false,
        // 190 = invalid/expired access token; 10/200 = permission denied.
        authFailed: code === 190 || code === 10 || code === 200,
        error: json.error?.message ?? `HTTP ${resp.status}`,
      };
    }
    return { ok: true, datasetName: json.name };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg.includes("timeout") ? "מטא לא הגיבה בזמן" : msg };
  }
}

interface LeadRow {
  sid: string;
  phone: string | null;
  leadgenId: string | null;
  email: string | null;
  /** Website-sourced leads have no leadgen id — Meta matches them on fbc/fbp. */
  fbclid: string | null;
  fbp: string | null;
  createdAtMs: number | null;
}

async function loadLeadForMeta(sid: string): Promise<LeadRow | null> {
  const res = await db.execute<{
    sid: string;
    phone: string | null;
    leadgen: string | null;
    email: string | null;
    lead_email: string | null;
    fbclid: string | null;
    fbp: string | null;
    created_ms: number | null;
  }>(sql`
    SELECT manychat_sub_id AS sid,
           phone_e164 AS phone,
           meta_leadgen_id AS leadgen,
           meta_form_email AS email,
           email AS lead_email,
           meta_fbclid AS fbclid,
           meta_fbp AS fbp,
           (EXTRACT(EPOCH FROM created_at) * 1000)::bigint AS created_ms
    FROM leads
    WHERE trim(manychat_sub_id) = ${sid.trim()}
    LIMIT 1`);
  const r = res.rows[0];
  if (!r) return null;
  return {
    sid: r.sid,
    phone: r.phone,
    leadgenId: r.leadgen,
    email: r.email || r.lead_email,
    fbclid: r.fbclid,
    fbp: r.fbp,
    createdAtMs: r.created_ms ? Number(r.created_ms) : null,
  };
}

/**
 * Send one CRM conversion event for a lead. Returns a result object; never
 * throws. Caller decides whether to await (fire-and-forget is fine).
 */
export async function sendMetaCrmEvent(
  sid: string,
  eventName: MetaEventName,
  opts: MetaSendOpts = {},
): Promise<MetaSendResult> {
  const { token, datasetId, version } = config();
  if (!token || !datasetId) return { ok: false, skipped: "not_configured" };

  let lead: LeadRow | null;
  try {
    lead = await loadLeadForMeta(sid);
  } catch (e) {
    return { ok: false, error: `load_failed: ${e instanceof Error ? e.message : e}` };
  }
  if (!lead) return { ok: false, skipped: "lead_not_found" };
  // Two attribution routes: Instant-Form leads carry a leadgen id; website
  // leads carry an fbclid (→ `fbc`). Either is enough for Meta to attribute.
  if (!lead.leadgenId && !lead.fbclid) {
    return { ok: false, skipped: "no_leadgen_id_or_fbclid" };
  }

  const userData: Record<string, unknown> = {};
  if (lead.leadgenId) {
    // Defensive: strip any leftover "l:" prefix (Meta's sheet format) → bare id.
    const leadgenClean = lead.leadgenId.replace(/^\s*l:/i, "").trim();
    // Meta lead_id: numeric when it fits, else string (both accepted).
    userData.lead_id = /^\d+$/.test(leadgenClean)
      ? Number(leadgenClean)
      : leadgenClean;
  }
  if (lead.fbclid) {
    // Meta's click-id format: fb.<subdomainIndex>.<creationMs>.<fbclid>
    userData.fbc = `fb.1.${lead.createdAtMs ?? Date.now()}.${lead.fbclid}`;
  }
  if (lead.fbp) userData.fbp = lead.fbp;
  if (lead.phone) userData.ph = [sha256(normPhone(lead.phone))];
  if (lead.email) userData.em = [sha256(normEmail(lead.email))];
  // external_id — a stable, hashed per-person id. Meta uses it both for match
  // quality and to tie Qualified/Purchase back to the SAME person, and unlike
  // em/ph we always have it. Hashed like the rest (Meta requires it hashed).
  userData.external_id = [sha256(lead.sid.trim().toLowerCase())];

  const customData: Record<string, unknown> = {
    event_source: "crm",
    lead_event_source: "Albadi CRM",
  };
  if (typeof opts.valueIls === "number" && opts.valueIls > 0) {
    customData.value = Math.round(opts.valueIls * 100) / 100;
    customData.currency = "ILS";
  } else if (eventName === "Purchase") {
    // A Purchase with no value is worse than useless: Meta counts the
    // conversion, reports ROAS against nothing, and flags the dataset as
    // "all your Purchase events send the same price data" — which is what a
    // run of value-less events looks like from its side. If we get here the
    // caller failed to resolve the deal total, so say so loudly rather than
    // shipping a silent placeholder.
    console.error(
      `[meta] Purchase for ${sid} has no value (got ${String(opts.valueIls)}) — ` +
        "reporting it would corrupt ROAS. Fix the caller's total lookup.",
    );
    return { ok: false, skipped: "purchase_without_value" };
  }

  const event = {
    action_source: "system_generated",
    event_name: eventName,
    event_time: opts.eventTime ?? Math.floor(Date.now() / 1000),
    event_id: opts.eventId ?? `${lead.sid}:${eventName}`,
    custom_data: customData,
    user_data: userData,
  };

  const body: Record<string, unknown> = { data: [event] };
  if (opts.testEventCode) body.test_event_code = opts.testEventCode;

  if (opts.preview) {
    return { ok: true, skipped: "preview", payload: event, matchKeys: Object.keys(userData) };
  }

  const url = `https://graph.facebook.com/${version}/${datasetId}/events?access_token=${encodeURIComponent(
    token,
  )}`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json: any = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return {
        ok: false,
        error: json?.error?.message
          ? `meta_${resp.status}: ${json.error.message}`
          : `meta_http_${resp.status}`,
        fbtraceId: json?.fbtrace_id,
      };
    }
    return {
      ok: true,
      eventsReceived: json?.events_received,
      fbtraceId: json?.fbtrace_id,
    };
  } catch (e) {
    return { ok: false, error: `fetch_failed: ${e instanceof Error ? e.message : e}` };
  }
}
