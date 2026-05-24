/**
 * Re-engagement message builder for leads in NO_RESPONSE_REENGAGE.
 *
 * Eli manually drags an opportunity into the NO_RESPONSE_REENGAGE stage when
 * a customer hasn't responded to 3 calls + 3 messages. The followup cron
 * then nudges every 3 days (skipping quiet hours + no-send days) with an
 * LLM-personalized message that:
 *   - reads the customer's prior thread + Eli's notes + bot_summary
 *   - writes a short, soft re-engagement note in Hebrew (1-2 sentences)
 *   - always appends the standard opt-out footer
 *
 * Soft-fails to a generic fallback if the LLM call errors — the cadence
 * keeps moving regardless.
 */
import { db } from "../db";
import { leads, messages } from "../../drizzle/schema";
import { desc, eq, sql } from "drizzle-orm";
import { callLLM } from "./openai-client";

export const RE_ENGAGEMENT_OPT_OUT_FOOTER =
  "\n\n_אם אינך מעוניין/ת לקבל הודעות נוספות, השב/י 'הסר' ולא אטריד שוב._";

const FALLBACK_BODY =
  "היי 👋 רק רציתי להזכיר שאנחנו כאן אם בא לך להתקדם עם ההצעה לשקיות הממותגות. תכתוב/י לי בכל זמן ואני אשמח להמשיך.";

const SYSTEM_PROMPT = `אתה אלי, בעל חברת אלבדי לאריזות וושקיות ממותגות. אתה כותב הודעת WhatsApp קצרה ללקוח שלא הגיב מזמן.

מטרה: לעורר את הלקוח לחזור לשיחה בעדינות. בלי לחץ, בלי מכירתיות גסה, בלי "החמצה".

חוקים:
- עברית בלבד.
- 1-2 משפטים, סה"כ עד 25 מילים. קצר.
- גוף ראשון יחיד ("אני / אחזור / אצור קשר") — לא "אנחנו" ולא "הצוות".
- בלי מחירים, בלי הצעות חדשות, בלי "מבצע".
- אסור להתחיל ב-"היי" אם ההיסטוריה מראה ששלחתי כבר "היי" לאחרונה — תשנה פתיח.
- אם יש בהערות פרט אישי רלוונטי (תערוכה, מועד מסוים, סוג מוצר ספציפי) — תרמוז עליו טבעי.
- אסור להזכיר את המילה "בוט". אתה אלי.
- בלי לסיים ב"מחכה לתשובה" או דומה.

החזר JSON בפורמט: {"message": "<הטקסט בלבד>"}`;

interface ReEngagementCtx {
  leadName: string | null;
  notes: string | null;
  botSummary: string | null;
  recent: { direction: "in" | "out"; text: string }[];
}

async function loadCtx(sid: string): Promise<ReEngagementCtx | null> {
  const [row] = await db
    .select({
      name: leads.name,
      notes: leads.notes,
      botSummary: leads.botSummary,
    })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${sid.trim()}`)
    .limit(1);
  if (!row) return null;
  const recentRows = await db
    .select({
      direction: messages.direction,
      text: messages.text,
    })
    .from(messages)
    .where(eq(messages.manychatSubId, sid.trim()))
    .orderBy(desc(messages.receivedAt))
    .limit(20);
  const recent = recentRows
    .filter((r) => r.text && r.text.trim().length > 0)
    .map((r) => ({ direction: r.direction as "in" | "out", text: r.text! }))
    .reverse();
  return {
    leadName: row.name,
    notes: row.notes,
    botSummary: row.botSummary,
    recent,
  };
}

function renderUserPrompt(ctx: ReEngagementCtx): string {
  const parts: string[] = [];
  if (ctx.leadName) parts.push(`שם לקוח: ${ctx.leadName}`);
  if (ctx.botSummary) parts.push(`סטטוס בוט: ${ctx.botSummary}`);
  if (ctx.notes) parts.push(`הערות פנימיות:\n${ctx.notes.slice(0, 1000)}`);
  parts.push("");
  parts.push("היסטוריית הודעות (newest last):");
  for (const m of ctx.recent) {
    const who = m.direction === "in" ? "לקוח" : "אלי";
    parts.push(`${who}: ${m.text.slice(0, 200)}`);
  }
  parts.push("");
  parts.push("כתוב הודעת re-engagement קצרה ל-WhatsApp.");
  return parts.join("\n");
}

export interface BuildReEngagementResult {
  text: string;
  /** True when the LLM produced the body; false when the deterministic fallback was used. */
  llmAuthored: boolean;
}

export async function buildReEngagementMessage(
  sid: string
): Promise<BuildReEngagementResult> {
  const ctx = await loadCtx(sid);
  if (!ctx) {
    return { text: FALLBACK_BODY + RE_ENGAGEMENT_OPT_OUT_FOOTER, llmAuthored: false };
  }

  try {
    const out = await callLLM<{ message?: string }>({
      system: SYSTEM_PROMPT,
      user: renderUserPrompt(ctx),
      temperature: 0.7,
      timeoutMs: 8000,
      retries: 1,
    });
    const body = out?.message?.trim();
    if (body && body.length > 0 && body.length < 600) {
      return { text: body + RE_ENGAGEMENT_OPT_OUT_FOOTER, llmAuthored: true };
    }
  } catch (e) {
    console.warn("[re-engagement] LLM error, falling back:", e);
  }
  return { text: FALLBACK_BODY + RE_ENGAGEMENT_OPT_OUT_FOOTER, llmAuthored: false };
}
