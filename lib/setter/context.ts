/**
 * Setter layer, stage 1 — the deterministic sales context.
 *
 * One object that states the deal's situation from the DB, so no LLM ever
 * re-invents "where are we with this lead" per turn. Everything here is a
 * fact we hold: quote amounts come from bot_quotes, missing info from
 * computeCallPrep, timing from the messages table.
 */
import { db } from "../db";
import { leads, messages, botQuotes } from "../../drizzle/schema";
import { desc, eq, sql } from "drizzle-orm";
import { computeCallPrep, type PrepItem } from "../autoresponder/call-prep";

export interface SalesContext {
  sid: string;
  name: string | null;
  /** Pipeline stage (INTAKE etc.) — null means still in the questionnaire. */
  stage: string | null;
  subFlow: string | null;
  quote: {
    sent: boolean;
    totalIls: number | null;
    sentAtIso: string | null;
  };
  missingInformation: PrepItem[];
  timing: {
    hoursSinceLastCustomerMessage: number | null;
    hoursSinceLastBotMessage: number | null;
    /** Who is being waited on: "us" = customer spoke last. */
    turn: "us" | "customer" | "nobody_yet";
  };
  /** Last few messages, oldest first — the classifier's raw material. */
  recentMessages: { from: "customer" | "us"; text: string }[];
  lastCustomerMessage: string | null;
}

const RECENT_LIMIT = 12;

export async function buildSalesContext(sid: string): Promise<SalesContext | null> {
  const [lead] = await db
    .select({
      name: leads.name,
      stage: leads.pipelineStage,
      qState: leads.qState,
      quoteTotal: leads.quoteTotal,
    })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${sid.trim()}`)
    .limit(1);
  if (!lead) return null;

  const q = (lead.qState ?? {}) as Record<string, unknown>;

  const [latestQuote] = await db
    .select({ totalIls: botQuotes.quoteTotalIls, at: botQuotes.sentAt })
    .from(botQuotes)
    .where(sql`trim(${botQuotes.leadSid}) = ${sid.trim()}`)
    .orderBy(desc(botQuotes.id))
    .limit(1);

  const recent = await db
    .select({
      direction: messages.direction,
      text: messages.text,
      at: messages.receivedAt,
    })
    .from(messages)
    .where(eq(messages.manychatSubId, sid.trim()))
    .orderBy(desc(messages.id))
    .limit(RECENT_LIMIT);
  recent.reverse();

  const lastIn = [...recent].reverse().find((m) => m.direction === "in");
  const lastOut = [...recent].reverse().find((m) => m.direction === "out");
  const hours = (d: Date | undefined | null) =>
    d ? Math.round(((Date.now() - d.getTime()) / 36e5) * 10) / 10 : null;

  const prep = await computeCallPrep(sid);

  return {
    sid: sid.trim(),
    name: lead.name,
    stage: lead.stage,
    subFlow: typeof q.subFlow === "string" ? q.subFlow : null,
    quote: {
      sent: !!latestQuote || !!lead.quoteTotal,
      totalIls: latestQuote?.totalIls ?? (lead.quoteTotal ? Number(lead.quoteTotal) || null : null),
      sentAtIso: latestQuote?.at?.toISOString() ?? null,
    },
    missingInformation: prep.missing,
    timing: {
      hoursSinceLastCustomerMessage: hours(lastIn?.at),
      hoursSinceLastBotMessage: hours(lastOut?.at),
      turn: !lastIn && !lastOut ? "nobody_yet" : (lastIn?.at?.getTime() ?? 0) > (lastOut?.at?.getTime() ?? 0) ? "us" : "customer",
    },
    recentMessages: recent
      .filter((m) => (m.text ?? "").trim())
      .map((m) => ({
        from: m.direction === "in" ? ("customer" as const) : ("us" as const),
        text: (m.text ?? "").slice(0, 400),
      })),
    lastCustomerMessage: lastIn?.text ?? null,
  };
}
