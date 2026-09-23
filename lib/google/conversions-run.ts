/**
 * Daily: report CRM progress of Google-click leads back to Google Ads as
 * offline conversions (plan phase 5). Rules: ./conversions.ts. Upload:
 * ./conversions-upload.ts (the only Google write in the CRM).
 *
 * In `validate` mode Google checks every event and nothing is stamped — the
 * same leads come back tomorrow. In `live` a lead is stamped per event only
 * after Google accepted the request; a failure is written to
 * `google_conversion_error` (shown on the Google connections screen and
 * alerted by google-ads-check).
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import type { FetchFn } from "./ads-client";
import { conversionsMode, dataManagerConfig, ingestEvents, type ConversionsMode } from "./conversions-upload";
import { ingestBody, pendingConversions, type ConvLead, type GoogleConvEvent, type PendingConversion } from "./conversions";

export interface ConversionsRunResult {
  mode: ConversionsMode;
  leads: number;
  pending: Record<GoogleConvEvent, number>;
  sent: number;
  validated: number;
  failed: number;
  reason: string | null;
}

type Row = {
  sid: string; gclid: string | null; gbraid: string | null; wbraid: string | null;
  click_at: string; stage: string | null; suitable_at: string | null; email: string | null; phone: string | null;
  q_at: string | null; o_at: string | null; p_at: string | null;
};

const COLUMN: Record<GoogleConvEvent, string> = {
  qualified: "google_qualified_sent_at",
  quote: "google_quote_sent_at",
  purchase: "google_purchase_sent_at",
};

export async function runGoogleConversions(opts: { fetchFn?: FetchFn; now?: Date; env?: Record<string, string | undefined>; includeTestLeads?: boolean } = {}): Promise<ConversionsRunResult> {
  const env = opts.env ?? process.env;
  const mode = conversionsMode(env);
  const now = opts.now ?? new Date();
  const empty: ConversionsRunResult = { mode, leads: 0, pending: { qualified: 0, quote: 0, purchase: 0 }, sent: 0, validated: 0, failed: 0, reason: null };
  if (mode === "off") return { ...empty, reason: "GOOGLE_CONVERSIONS_MODE=off" };

  const { getGooglePolicy } = await import("@/lib/ads/google-settings-store");
  const { settings } = await getGooglePolicy();
  const r = settings.reporting;
  const testFilter = opts.includeTestLeads ? sql`` : sql`AND l.manychat_sub_id NOT LIKE 'test:%'`;

  const res = await db.execute<Row>(sql`
    SELECT l.manychat_sub_id AS sid, l.google_gclid AS gclid, l.google_gbraid AS gbraid, l.google_wbraid AS wbraid,
           COALESCE(l.google_click_date::date::timestamptz, l.created_at)::text AS click_at,
           l.pipeline_stage AS stage,
           (SELECT min(t.set_at) FROM lead_tags t WHERE t.manychat_sub_id = l.manychat_sub_id
              AND lower(btrim(t.tag)) = lower(btrim(${settings.suitableLead.tag})))::text AS suitable_at,
           l.email, l.phone_e164 AS phone,
           l.google_qualified_sent_at::text AS q_at, l.google_quote_sent_at::text AS o_at, l.google_purchase_sent_at::text AS p_at
    FROM leads l
    WHERE (l.google_gclid IS NOT NULL OR l.google_gbraid IS NOT NULL OR l.google_wbraid IS NOT NULL)
      AND l.created_at > now() - interval '95 days'
      AND (l.google_qualified_sent_at IS NULL OR l.google_quote_sent_at IS NULL OR l.google_purchase_sent_at IS NULL)
      ${testFilter}`);
  if (res.rows.length === 0) return { ...empty };

  // Amounts from the canonical listClosedQuotes (grandTotalExVat); the close
  // moment from factory_quote_requests.closed_deal_at (ClosedQuoteRow carries
  // no close date). A deal closed only by stage has none → "now".
  const { listClosedQuotes } = await import("@/lib/factory/server/closed");
  const closedAt = new Map<string, Date>();
  const ca = await db.execute<{ sid: string; at: string }>(sql`
    SELECT btrim(manychat_sub_id) AS sid, min(closed_deal_at)::text AS at FROM factory_quote_requests
    WHERE closed_deal_at IS NOT NULL AND deleted_at IS NULL GROUP BY 1`);
  for (const x of ca.rows) closedAt.set(x.sid, new Date(x.at));
  const dealsBySid = new Map<string, { closedAt: Date; valueIls: number }[]>();
  for (const d of await listClosedQuotes()) {
    const sid = (d.leadSid ?? "").trim();
    if (!sid) continue;
    dealsBySid.set(sid, [...(dealsBySid.get(sid) ?? []), { closedAt: closedAt.get(sid) ?? now, valueIls: d.grandTotalExVat ?? 0 }]);
  }

  const leads: ConvLead[] = res.rows.map((x) => ({
    sid: x.sid,
    gclid: x.gclid,
    gbraid: x.gbraid,
    wbraid: x.wbraid,
    clickAt: new Date(x.click_at),
    stage: x.stage,
    suitable: Boolean(x.suitable_at),
    suitableAt: x.suitable_at ? new Date(x.suitable_at) : null,
    email: x.email,
    phoneE164: x.phone,
    qualifiedSentAt: x.q_at ? new Date(x.q_at) : null,
    quoteSentAt: x.o_at ? new Date(x.o_at) : null,
    purchaseSentAt: x.p_at ? new Date(x.p_at) : null,
    deals: dealsBySid.get(x.sid.trim()) ?? [],
  }));
  const bySid = new Map(leads.map((l) => [l.sid, l]));
  const values = { qualifiedValueIls: r.qualifiedValueIls, quoteValueIls: r.quoteValueIls, actions: { qualified: r.qualifiedActionId, quote: r.quoteActionId, purchase: r.purchaseActionId } };
  const pending: PendingConversion[] = leads.flatMap((l) => pendingConversions(l, values, now));

  const out: ConversionsRunResult = { ...empty, leads: leads.length };
  for (const p of pending) out.pending[p.event]++;
  if (pending.length === 0) return out;

  const customerId = dataManagerConfig(env).customerId;
  for (const event of ["qualified", "quote", "purchase"] as GoogleConvEvent[]) {
    const batch = pending.filter((p) => p.event === event);
    if (!batch.length) continue;
    const body = ingestBody(customerId, batch[0].actionId, batch.map((conv) => ({ conv, lead: bySid.get(conv.sid)! })), mode !== "live");
    const up = await ingestEvents(body, { fetchFn: opts.fetchFn, env });
    if (!up.ok) {
      out.failed += batch.length;
      out.reason = up.reason;
      if (mode === "live") {
        for (const p of batch) {
          await db.execute(sql`UPDATE leads SET google_conversion_error = ${`${event}: ${up.reason}`.slice(0, 500)}, google_conversion_error_at = now()
                               WHERE manychat_sub_id = ${p.sid}`);
        }
      }
      if (!up.configured) break; // no credentials — the other events would fail the same way
      continue;
    }
    if (mode === "live") {
      for (const p of batch) {
        await db.execute(sql`UPDATE leads SET ${sql.raw(COLUMN[event])} = now(), google_conversion_error = NULL, google_conversion_error_at = NULL
                             WHERE manychat_sub_id = ${p.sid}`);
      }
      out.sent += batch.length;
    } else {
      out.validated += batch.length;
    }
  }
  return out;
}
