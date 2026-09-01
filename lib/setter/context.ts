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
    /**
     * The total the customer is actually holding — or null when we can't be
     * sure, which is a state the writer must respect rather than fill in.
     */
    totalIls: number | null;
    sentAtIso: string | null;
    /**
     * A newer customer-facing quote exists (a factory quote sent, or Eli
     * pasting a price into the chat) that we can't reduce to one number.
     *
     * בתאל, 31/08: the bot's questionnaire auto-quote said ₪2,610; two hours
     * later Eli sent her ₪4,470 and ₪5,800 by hand. For two days the setter
     * opened every message with "בהצעה של ₪2,610" — a number she had stopped
     * looking at, which reads as a machine talking to itself. When this is
     * set, `totalIls` is deliberately null and the money guard in the
     * validator then rejects ANY ₪ figure in the message.
     */
    supersededAtIso: string | null;
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
  /**
   * What is already known about this lead outside the WhatsApp thread.
   *
   * Measured 2026-08-16 across the 119 active leads: 88 had analysed PHONE
   * CALLS, 114 had a stored sales verdict and 105 carried Eli's own notes —
   * and the setter read none of it. It was writing to someone whose objection
   * had been named on a call the week before, holding only the last twelve
   * chat messages. All of this is already computed and stored; not reading it
   * was the omission.
   */
  dossier: {
    /** Eli's notes on the contact, trimmed. */
    notes: string | null;
    /** The bot's own running summary of where this lead stands. */
    botSummary: string | null;
    /** Latest lead-analysis verdict — why this deal is stuck. */
    verdict: {
      rootCause: string | null;
      primaryBlocker: string | null;
      commitment: string | null;
    } | null;
    /** Most recent analysed phone call. */
    lastCall: {
      whenIso: string | null;
      summary: string | null;
      objections: string[];
      nextSteps: string[];
    } | null;
  };
}

const RECENT_LIMIT = 12;

export async function buildSalesContext(sid: string): Promise<SalesContext | null> {
  const [lead] = await db
    .select({
      name: leads.name,
      stage: leads.pipelineStage,
      qState: leads.qState,
      quoteTotal: leads.quoteTotal,
      notes: leads.notes,
      botSummary: leads.botSummary,
      ghlContactId: leads.ghlContactId,
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

  const supersededAtIso = await findNewerCustomerQuote(sid, latestQuote?.at ?? null);

  const prep = await computeCallPrep(sid);
  const dossier = await loadDossier(sid, lead.ghlContactId, lead.notes, lead.botSummary);

  return {
    sid: sid.trim(),
    name: lead.name,
    stage: lead.stage,
    subFlow: typeof q.subFlow === "string" ? q.subFlow : null,
    quote: {
      sent: !!latestQuote || !!lead.quoteTotal || !!supersededAtIso,
      totalIls: supersededAtIso
        ? null
        : latestQuote?.totalIls ?? (lead.quoteTotal ? Number(lead.quoteTotal) || null : null),
      sentAtIso: latestQuote?.at?.toISOString() ?? null,
      supersededAtIso,
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
    dossier,
  };
}


/**
 * Did anything newer than the bot's own auto-quote reach this customer?
 *
 * Two sources, because a real quote leaves two different traces: a row in
 * `factory_quote_requests` with `sent_to_customer_at`, and — just as often —
 * Eli pasting the quote into WhatsApp himself. Either one means the number in
 * `bot_quotes` is history.
 *
 * We deliberately do NOT try to work out which of the newer amounts is "the"
 * price: Eli routinely sends two quantities as options, and picking one would
 * be guessing at the customer's expense. Knowing that we don't know is the
 * useful output.
 */
async function findNewerCustomerQuote(
  sid: string,
  botQuoteAt: Date | null
): Promise<string | null> {
  const after = botQuoteAt ?? new Date(0);
  let newest: Date | null = null;
  const consider = (v: unknown) => {
    if (!v) return;
    const d = v instanceof Date ? v : new Date(String(v));
    if (Number.isNaN(d.getTime()) || d.getTime() <= after.getTime()) return;
    if (!newest || d > newest) newest = d;
  };

  try {
    const f = await db.execute(sql`
      SELECT max(sent_to_customer_at) AS at
      FROM factory_quote_requests
      WHERE trim(manychat_sub_id) = ${sid.trim()}
        AND sent_to_customer_at IS NOT NULL
        AND deleted_at IS NULL`);
    consider((((f as any).rows ?? f) as any[])[0]?.at);
  } catch (e) {
    console.warn("[setter.context] factory quote read failed", e);
  }

  try {
    const m = await db.execute(sql`
      SELECT max(received_at) AS at
      FROM messages
      WHERE manychat_sub_id = ${sid.trim()}
        AND direction = 'out' AND sender = 'eli'
        AND text ILIKE '%הצעת מחיר%' AND text LIKE '%₪%'`);
    consider((((m as any).rows ?? m) as any[])[0]?.at);
  } catch (e) {
    console.warn("[setter.context] manual quote read failed", e);
  }

  return newest ? (newest as Date).toISOString() : null;
}

/**
 * Markers our own pipelines stamp on the notes they write into GHL.
 *
 * `leads.notes` is a concatenation of EVERY note on the contact, and three of
 * our machines write there: the call analyser, the lead analyser and the deal
 * file. Passing the field raw would feed the generator its own earlier output
 * — the same verdict and call summary it already receives as structured
 * fields, wrapped in headers, burning tokens to say it twice. Only what a
 * human actually typed is useful here.
 */
const MACHINE_NOTE_MARKERS = [
  "[LEAD-ANALYSIS",
  "[CALL-ANALYSIS",
  "[CALLBACK",
  "[תיק עסקה]",
];

function humanNotesOnly(notes: string | null): string | null {
  if (!notes?.trim()) return null;
  const kept = notes
    .split(/\n(?=\[)/)
    .filter((block) => !MACHINE_NOTE_MARKERS.some((m) => block.trimStart().startsWith(m)))
    .join("\n")
    .trim();
  return kept ? kept.slice(0, 700) : null;
}

/**
 * Pull the already-computed knowledge about this lead.
 *
 * Deliberately compact: the verdict's root cause, the last call's summary and
 * what was agreed on it — not whole transcripts. The point is to stop writing
 * blind, not to bury the generator in context it has to wade through. Every
 * read is defensive; a missing dossier must never cost the lead its message.
 */
async function loadDossier(
  sid: string,
  ghlContactId: string | null,
  notes: string | null,
  botSummary: string | null
): Promise<SalesContext["dossier"]> {
  const base = {
    notes: humanNotesOnly(notes),
    botSummary: botSummary?.trim() || null,
    verdict: null as SalesContext["dossier"]["verdict"],
    lastCall: null as SalesContext["dossier"]["lastCall"],
  };

  try {
    const v = await db.execute(sql`
      SELECT verdict->>'root_cause' AS root_cause,
             verdict->>'primary_blocker' AS blocker,
             verdict->'commitment_scorecard'->>'score_1_5' AS commitment
      FROM lead_analyses
      WHERE trim(manychat_sub_id) = ${sid.trim()}
      ORDER BY created_at DESC LIMIT 1`);
    const row = (((v as any).rows ?? v) as any[])[0];
    if (row) {
      base.verdict = {
        rootCause: row.root_cause ? String(row.root_cause).slice(0, 400) : null,
        primaryBlocker: row.blocker ?? null,
        commitment: row.commitment ?? null,
      };
    }
  } catch (e) {
    console.warn("[setter.context] verdict read failed", e);
  }

  if (ghlContactId) {
    try {
      const c = await db.execute(sql`
        SELECT call_started_at,
               analysis->>'call_summary' AS summary,
               analysis->'objections' AS objections,
               analysis->'next_steps' AS next_steps
        FROM call_recording_imports
        WHERE ghl_contact_id = ${ghlContactId} AND analysis IS NOT NULL
        ORDER BY call_started_at DESC LIMIT 1`);
      const row = (((c as any).rows ?? c) as any[])[0];
      if (row) {
        const list = (x: unknown): string[] =>
          Array.isArray(x) ? x.map(String).filter(Boolean).slice(0, 3) : [];
        base.lastCall = {
          whenIso: row.call_started_at ? new Date(row.call_started_at).toISOString() : null,
          summary: row.summary ? String(row.summary).slice(0, 400) : null,
          objections: list(row.objections),
          nextSteps: list(row.next_steps),
        };
      }
    } catch (e) {
      console.warn("[setter.context] call read failed", e);
    }
  }

  return base;
}
