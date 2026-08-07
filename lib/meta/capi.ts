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
}

export interface MetaSendResult {
  ok: boolean;
  skipped?: string; // reason when not sent
  eventsReceived?: number;
  fbtraceId?: string;
  error?: string;
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

interface LeadRow {
  sid: string;
  phone: string | null;
  leadgenId: string | null;
  email: string | null;
}

async function loadLeadForMeta(sid: string): Promise<LeadRow | null> {
  const res = await db.execute<{
    sid: string;
    phone: string | null;
    leadgen: string | null;
    email: string | null;
    lead_email: string | null;
  }>(sql`
    SELECT manychat_sub_id AS sid,
           phone_e164 AS phone,
           meta_leadgen_id AS leadgen,
           meta_form_email AS email,
           email AS lead_email
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
  if (!lead.leadgenId) return { ok: false, skipped: "no_leadgen_id" };

  const userData: Record<string, unknown> = {};
  // Meta lead_id: numeric when it fits, else string (both accepted).
  userData.lead_id = /^\d+$/.test(lead.leadgenId)
    ? Number(lead.leadgenId)
    : lead.leadgenId;
  if (lead.phone) userData.ph = [sha256(normPhone(lead.phone))];
  if (lead.email) userData.em = [sha256(normEmail(lead.email))];

  const customData: Record<string, unknown> = {
    event_source: "crm",
    lead_event_source: "Albadi CRM",
  };
  if (typeof opts.valueIls === "number" && opts.valueIls > 0) {
    customData.value = Math.round(opts.valueIls * 100) / 100;
    customData.currency = "ILS";
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
