/**
 * Durable milestones for each automated quote-funnel attempt.
 *
 * These writes are deliberately idempotent and soft-fail: analytics must not
 * delay or break a customer conversation. The unique event key prevents a
 * retry from duplicating one milestone while preserving genuine restarts.
 */
import { db } from "@/lib/db";
import { botFunnelEvents, botQuotes, leads } from "@/drizzle/schema";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import { logger, serializeError } from "@/lib/observability/log";
import { buildFunnelEventIdentity } from "./funnel-event-identity";

const log = logger("bot");

export const BOT_FUNNEL_EVENTS = [
  "questionnaire_started",
  "quantity_answered",
  "size_answered",
  "colors_answered",
  "colors_unknown",
  "logo_requested",
  "logo_received",
  "spec_confirmed",
  "quote_sent",
  "express_requested",
  "post_quote_reply",
  "human_handoff",
  "rep_contacted",
  "conversation_held",
  "qualified_ready",
  "qualified_not_ready",
  "unqualified",
  "first_payment_received",
  // Historical/additional milestones retained for backwards compatibility.
  "shipping_answered",
  "size_selected",
  "quote_replied",
  "call_booked",
  "deal_closed",
  "human_contacted",
  "call_completed",
  "qualified",
  "followup_sent",
  "lost",
] as const;

export type BotFunnelEvent = (typeof BOT_FUNNEL_EVENTS)[number];

export async function recordBotFunnelEvent(input: {
  leadSid: string;
  event: BotFunnelEvent;
  attemptId?: string | null;
  eventKey?: string;
  occurredAt?: Date;
  quoteId?: string | number | null;
  value?: unknown;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const sid = input.leadSid.trim();
    const [lead] = await db
      .select({
        qState: leads.qState,
        source: leads.source,
        leadSource: leads.leadSource,
        adId: leads.metaAdId,
        adName: leads.metaAdName,
        campaignId: leads.metaCampaignId,
        campaignName: leads.metaCampaignName,
      })
      .from(leads)
      .where(sql`trim(${leads.manychatSubId}) = ${sid}`)
      .limit(1);
    const qState = (lead?.qState ?? null) as { attemptId?: string } | null;
    const identity = buildFunnelEventIdentity({
      leadSid: sid,
      event: input.event,
      explicitAttemptId: input.attemptId,
      stateAttemptId: qState?.attemptId,
      explicitEventKey: input.eventKey,
    });
    const inserted = await db
      .insert(botFunnelEvents)
      .values({
        leadSid: identity.leadSid,
        attemptId: identity.attemptId,
        event: input.event,
        eventKey: identity.eventKey,
        occurredAt: input.occurredAt ?? new Date(),
        botVersion:
          process.env.VERCEL_GIT_COMMIT_SHA ??
          process.env.npm_package_version ??
          "local",
        source: lead?.leadSource ?? lead?.source ?? "unknown",
        value: input.value ?? null,
        adId: lead?.adId ?? null,
        adName: lead?.adName ?? null,
        campaignId: lead?.campaignId ?? null,
        campaignName: lead?.campaignName ?? null,
        quoteId: input.quoteId == null ? null : String(input.quoteId),
        metadata: input.metadata ?? null,
      })
      .onConflictDoNothing({
        target: botFunnelEvents.eventKey,
      })
      .returning({ id: botFunnelEvents.id });
    if (inserted.length > 0) {
      log.info("funnel_event.recorded", {
        sid: identity.leadSid,
        event: input.event,
        attempt_id: identity.attemptId,
        event_key: identity.eventKey,
      });
    }
  } catch (e) {
    log.warn("funnel_event.insert_failed", {
      sid: input.leadSid,
      event: input.event,
      ...serializeError(e),
    });
  }
}

/** Record the first customer response sent after their first bot quote. */
export async function recordQuoteReplyIfEligible(
  leadSid: string,
  occurredAt: Date = new Date()
): Promise<void> {
  try {
    const [quote] = await db
      .select({ id: botQuotes.id })
      .from(botQuotes)
      .where(
        and(
          sql`trim(${botQuotes.leadSid}) = ${leadSid.trim()}`,
          eq(botQuotes.source, "initial"),
          lte(botQuotes.sentAt, occurredAt)
        )
      )
      .orderBy(asc(botQuotes.sentAt))
      .limit(1);
    if (!quote) return;
    await recordBotFunnelEvent({
      leadSid,
      event: "post_quote_reply",
      occurredAt,
      quoteId: quote.id,
    });
  } catch (e) {
    log.warn("funnel_event.quote_reply_check_failed", {
      sid: leadSid,
      ...serializeError(e),
    });
  }
}
