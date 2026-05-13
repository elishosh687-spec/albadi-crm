/**
 * Post-questionnaire decision sub-flow. Drives leads through:
 *
 *   AWAITING_DECISION  (bot asked "does the quote work?")
 *     ├─ accept            → AWAITING_LOGO   (bot asks customer to send logo)
 *     ├─ samples_request   → send catalog URL, stay in AWAITING_DECISION
 *     ├─ reject / negotiating / custom_size / question
 *                          → NEEDS_ELI + bot_paused, DM Eli with summary
 *     └─ other             → no-op (follow-up cron keeps nudging)
 *
 *   AWAITING_LOGO
 *     ├─ media inbound (image / file)  → IN_PROGRESS, DM Eli to call & close
 *     └─ text-only inbound             → re-ask up to 3x, then NEEDS_ELI
 *
 * Both sub-flows respect bot_paused (caller skips this module when paused).
 */
import { db } from "../db";
import { leads, messages as messagesTable } from "../../drizzle/schema";
import { desc, sql, eq } from "drizzle-orm";
import { sendBridgeMessage } from "../bridge/client";
import { sendEliDM } from "../notify/eli";
import { classifyIntent, type Intent } from "./intent";

const CATALOG_URL = "https://bag-quote-app.vercel.app/catalog";

const ACCEPT_REPLY =
  "מעולה! 🎉 שלח לי בבקשה את הלוגו כתמונה כאן בוואטסאפ ונמשיך הלאה.";
const SAMPLES_REPLY = `בטח! הנה הקטלוג שלנו 📚\n${CATALOG_URL}`;
const LOGO_REASK =
  "תודה! 🙏 כדי להמשיך אנחנו צריכים גם את הלוגו — אפשר לשלוח כתמונה כאן?";
const LOGO_ESCALATE_REPLY =
  "תודה! 🙏 קיבלנו את ההודעה, אחד מאיתנו יחזור אליך בקרוב.";

interface LeadCtx {
  sid: string;
  jid: string;
  name: string | null;
  phone: string | null;
  pipelineStage: string | null;
  qState: any;
  followUpCount: number;
}

async function loadLeadCtx(sid: string): Promise<LeadCtx | null> {
  const [row] = await db
    .select({
      sid: leads.manychatSubId,
      jid: leads.waJid,
      name: leads.name,
      phone: leads.phoneE164,
      pipelineStage: leads.pipelineStage,
      qState: leads.qState,
      followUpCount: leads.followUpCount,
    })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${sid.trim()}`)
    .limit(1);
  if (!row) return null;
  return {
    sid: row.sid,
    jid: row.jid ?? sid,
    name: row.name,
    phone: row.phone,
    pipelineStage: row.pipelineStage,
    qState: row.qState,
    followUpCount: row.followUpCount,
  };
}

async function loadRecentMessages(
  sid: string,
  limit = 8
): Promise<{ direction: "in" | "out"; text: string }[]> {
  const rows = await db
    .select({ direction: messagesTable.direction, text: messagesTable.text })
    .from(messagesTable)
    .where(eq(messagesTable.manychatSubId, sid.trim()))
    .orderBy(desc(messagesTable.receivedAt))
    .limit(limit);
  return rows
    .filter((r) => r.text)
    .map((r) => ({ direction: r.direction as "in" | "out", text: r.text! }))
    .reverse();
}

async function escalateToEli(
  ctx: LeadCtx,
  reason: string,
  llmSummary?: string
): Promise<void> {
  await db
    .update(leads)
    .set({
      pipelineFlag: "NEEDS_ELI",
      botPaused: true,
      botSummary: llmSummary ?? reason,
      updatedAt: new Date(),
    })
    .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`);
  const who = ctx.name?.trim() || ctx.phone || ctx.sid;
  const stage = ctx.pipelineStage || "?";
  const summaryLine = llmSummary ? `\n📝 ${llmSummary}` : "";
  await sendEliDM(`🚨 ${who} (שלב ${stage}) — ${reason}.${summaryLine} כדאי להתקשר.`);
}

export interface DecisionResult {
  action:
    | "no_op"
    | "accept_routed"
    | "samples_sent"
    | "escalated"
    | "logo_received"
    | "logo_reasked";
  intent?: Intent;
  detail?: string;
}

/**
 * Handle inbound for a lead currently in AWAITING_DECISION or AWAITING_LOGO.
 * Returns no_op for any other stage (caller decides what to do).
 */
export async function handleDecisionInbound(input: {
  sid: string;
  text: string | null;
  hasMedia: boolean;
}): Promise<DecisionResult> {
  const ctx = await loadLeadCtx(input.sid);
  if (!ctx) return { action: "no_op", detail: "no lead row" };

  const stage = (ctx.pipelineStage ?? "").toUpperCase();

  if (stage === "AWAITING_LOGO") {
    return handleLogoStage(ctx, input.text, input.hasMedia);
  }
  if (stage === "AWAITING_DECISION") {
    return handleDecisionStage(ctx, input.text);
  }
  return { action: "no_op", detail: `stage=${stage}` };
}

async function handleDecisionStage(
  ctx: LeadCtx,
  text: string | null
): Promise<DecisionResult> {
  const t = (text ?? "").trim();
  if (!t) return { action: "no_op", detail: "empty text" };

  const recent = await loadRecentMessages(ctx.sid);
  const classification = await classifyIntent({
    inboundText: t,
    recentMessages: recent,
    leadName: ctx.name,
    pipelineStage: ctx.pipelineStage,
  });

  switch (classification.intent) {
    case "accept": {
      await db
        .update(leads)
        .set({
          pipelineStage: "AWAITING_LOGO",
          followUpCount: 0,
          lastFollowUpAt: new Date(),
          botSummary: "customer accepted quote — awaiting logo",
          updatedAt: new Date(),
        })
        .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`);
      await sendBridgeMessage(ctx.jid, ACCEPT_REPLY);
      return { action: "accept_routed", intent: classification.intent };
    }

    case "samples_request": {
      await sendBridgeMessage(ctx.jid, SAMPLES_REPLY);
      return { action: "samples_sent", intent: classification.intent };
    }

    case "reject":
    case "negotiating":
    case "custom_size":
    case "question": {
      const reasonMap: Record<typeof classification.intent, string> = {
        reject: "הלקוח דחה את ההצעה",
        negotiating: "הלקוח רוצה הנחה / מתמקח על המחיר",
        custom_size: "הלקוח ביקש מידה או כמות לא סטנדרטית",
        question: "הלקוח שאל שאלה שהבוט לא יכול לענות עליה",
      };
      await escalateToEli(
        ctx,
        reasonMap[classification.intent],
        classification.summary
      );
      return {
        action: "escalated",
        intent: classification.intent,
        detail: classification.summary,
      };
    }

    case "other":
    default:
      // Ambiguous — let the follow-up cron keep nudging. Don't touch the
      // counter; cron will tick it on the next cadence boundary.
      return { action: "no_op", intent: classification.intent, detail: "ambiguous" };
  }
}

async function handleLogoStage(
  ctx: LeadCtx,
  text: string | null,
  hasMedia: boolean
): Promise<DecisionResult> {
  if (hasMedia) {
    await db
      .update(leads)
      .set({
        pipelineStage: "IN_PROGRESS",
        pipelineFlag: "NEEDS_ELI",
        botPaused: true,
        botSummary: "logo received — call to close",
        followUpCount: 0,
        updatedAt: new Date(),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`);
    const who = ctx.name?.trim() || ctx.phone || ctx.sid;
    await sendEliDM(`✅ ${who} שלח לוגו — צריך להתקשר ולסגור עסקה.`);
    await sendBridgeMessage(ctx.jid, LOGO_ESCALATE_REPLY);
    return { action: "logo_received" };
  }

  // Text-only. Re-ask up to 3 times (uses follow_up_count for the budget).
  const attempt = (ctx.followUpCount ?? 0) + 1;
  if (attempt >= 3) {
    await escalateToEli(ctx, "הלקוח לא שלח לוגו אחרי 3 בקשות", undefined);
    return { action: "escalated", detail: "no logo after 3 attempts" };
  }
  await db
    .update(leads)
    .set({
      followUpCount: attempt,
      lastFollowUpAt: new Date(),
      updatedAt: new Date(),
    })
    .where(sql`trim(${leads.manychatSubId}) = ${ctx.sid.trim()}`);
  await sendBridgeMessage(ctx.jid, LOGO_REASK);
  return { action: "logo_reasked", detail: `attempt ${attempt}` };
}
