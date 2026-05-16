/**
 * Append-only quote history writer. Every bot-side WhatsApp quote (initial
 * questionnaire completion + auto-requote after spec change) gets a row in
 * `bot_quotes`. The dashboard's OrderSummary panel renders the timeline so
 * Eli can see what the customer was first quoted vs. what they're being
 * quoted now, even though leads.quoteTotal only holds the latest value.
 *
 * Soft-fail by design: a logging error must never block sending the quote
 * to the customer.
 */
import { db } from "../db";
import { botQuotes } from "../../drizzle/schema";
import type { QState } from "./questionnaire";

export type BotQuoteSource = "initial" | "requote";

export async function logBotQuote(input: {
  leadSid: string;
  source: BotQuoteSource;
  state: QState;
  text: string;
  totalIls: number;
  altTotalIls: number | null;
}): Promise<void> {
  try {
    await db.insert(botQuotes).values({
      leadSid: input.leadSid.trim(),
      source: input.source,
      qState: input.state as any,
      quoteText: input.text,
      quoteTotalIls: input.totalIls,
      quoteAltTotalIls: input.altTotalIls,
    });
  } catch (e) {
    console.warn(
      "[quote-log] insert failed",
      input.leadSid,
      input.source,
      e instanceof Error ? e.message : e
    );
  }
}
