/**
 * Durable first-occurrence milestones for the automated quote funnel.
 *
 * These writes are deliberately idempotent and soft-fail: analytics must not
 * delay or break a customer conversation. The unique (lead,event) key means a
 * questionnaire restart/requote does not inflate the lead conversion funnel.
 */
import { db } from "@/lib/db";
import { botFunnelEvents, botQuotes } from "@/drizzle/schema";
import { and, eq, lte, sql } from "drizzle-orm";
import { logger, serializeError } from "@/lib/observability/log";

const log = logger("bot");

export const BOT_FUNNEL_EVENTS = [
  "questionnaire_started",
  "questionnaire_completed",
  "quote_sent",
  "quote_replied",
] as const;

export type BotFunnelEvent = (typeof BOT_FUNNEL_EVENTS)[number];

export async function recordBotFunnelEvent(input: {
  leadSid: string;
  event: BotFunnelEvent;
  occurredAt?: Date;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db
      .insert(botFunnelEvents)
      .values({
        leadSid: input.leadSid.trim(),
        event: input.event,
        occurredAt: input.occurredAt ?? new Date(),
        metadata: input.metadata ?? null,
      })
      .onConflictDoNothing({
        target: [botFunnelEvents.leadSid, botFunnelEvents.event],
      });
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
      .limit(1);
    if (!quote) return;
    await recordBotFunnelEvent({
      leadSid,
      event: "quote_replied",
      occurredAt,
    });
  } catch (e) {
    log.warn("funnel_event.quote_reply_check_failed", {
      sid: leadSid,
      ...serializeError(e),
    });
  }
}
