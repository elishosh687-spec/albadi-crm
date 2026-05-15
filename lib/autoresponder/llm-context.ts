/**
 * Shared context loader for every LLM call in the autoresponder.
 *
 * One call site builds the full context (history + qState + profile + tags +
 * FAQ + business rules); spec-extractor and unmatch-agent both inject it via
 * `renderContextForPrompt`. Keeping it here means we don't drift between the
 * two — they always see the same view of the lead.
 *
 * Token budget target: ~3K tokens for the full render. History is the biggest
 * lever — clamp to last 20 messages.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db";
import {
  leads,
  messages as messagesTable,
  leadTags,
} from "../../drizzle/schema";
import { desc, eq, sql } from "drizzle-orm";

const HISTORY_LIMIT = 20;

export interface LLMContext {
  lead: {
    sid: string;
    name: string | null;
    phone: string | null;
    pipelineStage: string | null;
    pipelineFlag: string | null;
    botPaused: boolean;
    qState: any;
    notes: string | null;
    quoteTotal: string | null;
    createdAt: Date | string | null;
    tags: string[];
  };
  recentMessages: {
    direction: "in" | "out";
    text: string;
    receivedAt: Date | string;
  }[];
  faq: string;
  businessRules: string;
}

// --- FAQ + business rules: loaded once per process and cached. ---

let cachedFaq: string | null = null;

function loadFaq(): string {
  if (cachedFaq !== null) return cachedFaq;
  try {
    const path = join(process.cwd(), "docs", "PRODUCT-FAQ.md");
    cachedFaq = readFileSync(path, "utf-8");
  } catch (e) {
    console.warn(
      "[llm-context] PRODUCT-FAQ.md not readable — continuing without FAQ",
      e instanceof Error ? e.message : e
    );
    cachedFaq = "";
  }
  return cachedFaq;
}

const BUSINESS_RULES = `שעות פעילות: א-ה 9:00-18:00 (Asia/Jerusalem)
שישי-שבת + חגים יהודיים: לא שולחים תזכורות / הודעות יזומות
מינימום הזמנה: 500 יחידות
זמני אספקה (מאישור הזמנה): אקספרס ~25 יום, רגיל ~90 יום
תשלום: 50% בעת ההזמנה, 50% לפני יציאת הסחורה מהמפעל
מטבע: ILS
המחיר כולל: ייצור + הדפסה + משלוח לארץ + מע"מ`;

// --- Public API ---

export async function buildLLMContext(sid: string): Promise<LLMContext | null> {
  const sidTrim = sid.trim();

  const [lead] = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      pipelineStage: leads.pipelineStage,
      pipelineFlag: leads.pipelineFlag,
      botPaused: leads.botPaused,
      qState: leads.qState,
      notes: leads.notes,
      quoteTotal: leads.quoteTotal,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${sidTrim}`)
    .limit(1);

  if (!lead) return null;

  const recent = await db
    .select({
      direction: messagesTable.direction,
      text: messagesTable.text,
      receivedAt: messagesTable.receivedAt,
    })
    .from(messagesTable)
    .where(eq(messagesTable.manychatSubId, sidTrim))
    .orderBy(desc(messagesTable.receivedAt))
    .limit(HISTORY_LIMIT);

  const tagRows = await db
    .select({ tag: leadTags.tag })
    .from(leadTags)
    .where(eq(leadTags.manychatSubId, sidTrim));

  return {
    lead: {
      sid: lead.sid,
      name: lead.name,
      phone: lead.phone,
      pipelineStage: lead.pipelineStage,
      pipelineFlag: lead.pipelineFlag,
      botPaused: !!lead.botPaused,
      qState: lead.qState,
      notes: lead.notes,
      quoteTotal: lead.quoteTotal,
      createdAt: lead.createdAt,
      tags: tagRows.map((r) => r.tag),
    },
    recentMessages: recent
      .filter((r) => r.text)
      .map((r) => ({
        direction: r.direction as "in" | "out",
        text: r.text!,
        receivedAt: r.receivedAt,
      }))
      .reverse(),
    faq: loadFaq(),
    businessRules: BUSINESS_RULES,
  };
}

/**
 * Render context as a Hebrew block ready to drop into a system / user prompt.
 * Sections are skipped when empty.
 */
export function renderContextForPrompt(ctx: LLMContext): string {
  const lines: string[] = [];

  lines.push("=== פרופיל הליד ===");
  if (ctx.lead.name) lines.push(`שם: ${ctx.lead.name}`);
  if (ctx.lead.phone) lines.push(`טלפון: ${ctx.lead.phone}`);
  if (ctx.lead.pipelineStage) lines.push(`Stage: ${ctx.lead.pipelineStage}`);
  if (ctx.lead.pipelineFlag) lines.push(`Flag: ${ctx.lead.pipelineFlag}`);
  if (ctx.lead.botPaused) lines.push("Bot paused: כן");
  if (ctx.lead.tags.length > 0) lines.push(`Tags: ${ctx.lead.tags.join(", ")}`);
  if (ctx.lead.notes) lines.push(`Notes (אלי): ${ctx.lead.notes}`);
  if (ctx.lead.quoteTotal) lines.push(`מחיר שנשלח: ${ctx.lead.quoteTotal}`);

  if (ctx.lead.qState) {
    const s = ctx.lead.qState as any;
    const fields: string[] = [];
    if (s.quantity) fields.push(`כמות: ${s.quantityCustom || s.quantity}`);
    if (s.product) fields.push(`מידה: ${s.productCustom || s.product}`);
    if (s.shipping) {
      const shipMap: Record<string, string> = { s1: "אקספרס", s2: "רגיל" };
      fields.push(`משלוח: ${shipMap[s.shipping] ?? s.shipping}`);
    }
    if (s.handles)
      fields.push(`ידיות: ${s.handles === "true" ? "כן" : "לא"}`);
    if (s.colors) fields.push(`צבעים: ${s.colors}`);
    if (s.orderNotes) fields.push(`הערות לקוח: ${s.orderNotes}`);
    if (fields.length > 0) {
      lines.push("\n=== מה הבוט אסף מהשאלון ===");
      lines.push(...fields);
    }
  }

  if (ctx.recentMessages.length > 0) {
    lines.push("\n=== היסטוריית שיחה (הישנה ראשון) ===");
    for (const m of ctx.recentMessages) {
      const who = m.direction === "in" ? "לקוח" : "בוט";
      lines.push(`${who}: ${m.text}`);
    }
  }

  if (ctx.businessRules) {
    lines.push("\n=== כללי עסק ===");
    lines.push(ctx.businessRules);
  }

  if (ctx.faq) {
    lines.push("\n=== ידע מוצר (FAQ) ===");
    lines.push(ctx.faq);
  }

  return lines.join("\n");
}

/** Test helper — reset the FAQ cache so unit tests / hot-reload re-read disk. */
export function _resetFaqCache(): void {
  cachedFaq = null;
}
