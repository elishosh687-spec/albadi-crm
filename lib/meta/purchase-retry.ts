/**
 * Retry Purchase reports that FAILED when the deal was closed.
 *
 * `reportPurchaseToMeta` (closed.ts) sends once, at "סגור עסקה", and stamps
 * the outcome. A transient failure — סהר צור on 16/09/2026 got
 * "Error connecting to database: fetch failed" — was stamped as an error and
 * then nothing ever tried again: the deal sat as "failed" on the ads tab and
 * Meta never learned that ad produced a paying customer.
 *
 * Runs inside the daily `/api/cron/enrich-meta-attribution`. Selection is
 * deliberately narrow, so a permanent refusal cannot become a daily resend:
 *   - a closed deal whose Purchase has NOT been stamped sent,
 *   - that has a recorded error (it was attempted and failed),
 *   - whose lead has an attribution key (leadgen id or fbclid),
 *   - with a positive value (value-less Purchases are refused by design),
 *   - closed within RETRY_WINDOW_DAYS (a structurally broken one stops).
 * event_id is `<sid>:Purchase`, the same as the live sender, so Meta dedups
 * if the original send actually landed.
 */
import { db } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { listClosedQuotes } from "@/lib/factory/server/closed";
import { sendMetaCrmEvent } from "@/lib/meta/capi";
import { logger } from "@/lib/observability/log";

const log = logger("meta");

export const RETRY_WINDOW_DAYS = 45;
/** Meta refuses event_time older than 7 days; keep a margin. */
const MAX_EVENT_AGE_SEC = 6 * 24 * 60 * 60;

export interface RetryCandidateInput {
  dealId: string;
  leadSid: string | null;
  customerName: string | null;
  valueExVat: number;
  sentAt: string | null;
  error: string | null;
  closedAt: string | null;
  hasAttributionKey: boolean;
}

export interface RetryCandidate {
  dealId: string;
  sid: string;
  name: string;
  value: number;
  /** Clamped epoch seconds for event_time. */
  eventTime: number;
  previousError: string;
}

/** Pure selection — unit-tested. */
export function selectPurchaseRetries(rows: RetryCandidateInput[], nowMs: number): RetryCandidate[] {
  const nowSec = Math.floor(nowMs / 1000);
  const windowMs = RETRY_WINDOW_DAYS * 86_400_000;
  const out: RetryCandidate[] = [];
  for (const r of rows) {
    const sid = (r.leadSid ?? "").trim();
    if (!sid || r.sentAt || !r.error || !r.hasAttributionKey || !(r.valueExVat > 0)) continue;
    const closedMs = r.closedAt ? Date.parse(r.closedAt) : NaN;
    if (!Number.isFinite(closedMs) || nowMs - closedMs > windowMs) continue;
    const closedSec = Math.floor(closedMs / 1000);
    out.push({
      dealId: r.dealId,
      sid,
      name: r.customerName ?? sid,
      value: r.valueExVat,
      eventTime: Math.min(nowSec, Math.max(closedSec, nowSec - MAX_EVENT_AGE_SEC)),
      previousError: r.error,
    });
  }
  return out;
}

export interface PurchaseRetryResult {
  candidates: number;
  sent: number;
  failed: number;
  names: string[];
  errors: string[];
}

export async function retryFailedPurchases(opts: { dry?: boolean } = {}): Promise<PurchaseRetryResult> {
  const deals = await listClosedQuotes();
  const stamps = await db.execute<{
    id: string;
    sent_at: string | null;
    err: string | null;
    closed_at: string | null;
  }>(sql`
    SELECT id, meta_purchase_sent_at::text AS sent_at, meta_purchase_error AS err,
           COALESCE(closed_deal_at, updated_at)::text AS closed_at
    FROM factory_quote_requests
    WHERE meta_purchase_error IS NOT NULL AND meta_purchase_sent_at IS NULL`);
  if (stamps.rows.length === 0) return { candidates: 0, sent: 0, failed: 0, names: [], errors: [] };
  const byId = new Map(stamps.rows.map((r) => [r.id, r]));

  const keys = await db.execute<{ sid: string }>(sql`
    SELECT trim(manychat_sub_id) AS sid FROM leads
    WHERE meta_leadgen_id IS NOT NULL OR meta_fbclid IS NOT NULL`);
  const keyed = new Set(keys.rows.map((r) => r.sid));

  const candidates = selectPurchaseRetries(
    deals
      .filter((d) => byId.has(d.id))
      .map((d) => {
        const st = byId.get(d.id)!;
        return {
          dealId: d.id,
          leadSid: d.leadSid,
          customerName: d.customerName ?? null,
          valueExVat: d.grandTotalExVat,
          sentAt: st.sent_at,
          error: st.err,
          closedAt: st.closed_at,
          hasAttributionKey: keyed.has((d.leadSid ?? "").trim()),
        };
      }),
    Date.now(),
  );

  const result: PurchaseRetryResult = { candidates: candidates.length, sent: 0, failed: 0, names: candidates.map((c) => c.name), errors: [] };
  if (opts.dry) return result;

  for (const c of candidates) {
    const r = await sendMetaCrmEvent(c.sid, "Purchase", {
      valueIls: c.value,
      eventTime: c.eventTime,
      eventId: `${c.sid}:Purchase`,
    });
    await db
      .update(factoryQuoteRequests)
      .set(
        r.ok
          ? { metaPurchaseSentAt: new Date(), metaPurchaseValueIls: c.value, metaPurchaseError: null }
          : { metaPurchaseError: r.error ?? r.skipped ?? "unknown" },
      )
      .where(eq(factoryQuoteRequests.id, c.dealId));
    if (r.ok) result.sent++;
    else {
      result.failed++;
      result.errors.push(`${c.dealId}: ${r.error ?? r.skipped ?? "unknown"}`);
    }
  }
  log.info("purchase_retry.done", { candidates: result.candidates, sent: result.sent, failed: result.failed });
  return result;
}
