/**
 * Hourly bot trigger — called by Anthropic cloud routine via HTTP.
 *
 * Security: requires Authorization: Bearer <BOT_SECRET> header.
 * Phase 1: read-only — pulls leads, classifies via rules, saves decisions.
 *          Does NOT update ManyChat tags.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSubscriber, getFieldValue } from "@/lib/manychat/client";
import { TAG_IDS, TERMINAL_TAGS } from "@/lib/manychat/config";
import { db } from "@/lib/db";
import { botRuns, decisions, escalations, leads } from "@/drizzle/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 60;

const tagIdToName: Record<number, string> = Object.fromEntries(
  Object.entries(TAG_IDS).map(([k, v]) => [v, k])
);

interface Lead {
  subscriberId: string;
  name: string;
  currentTag: string | null;
  notes: string | null;
  quoteTotal: number | null;
  daysSinceContact: number | null;
}

interface Outcome {
  classifiedTag: string | null;
  rule: string | null;
  aiUsed: boolean;
  confidence: number | null;
  action: "tag_only" | "escalated" | "no_action";
  escalationReason?: string;
  escalationTrigger?: string;
}

function applyRules(lead: Lead): Outcome {
  const days = lead.daysSinceContact ?? 0;
  const tag = lead.currentTag;
  const notes = (lead.notes || "").toLowerCase();

  if (tag === "לא_ענה" && days < 7) {
    return { classifiedTag: tag, rule: "no_action_stable", aiUsed: false, confidence: 1.0, action: "no_action" };
  }
  if (notes.includes("הנחה") || notes.includes("יקר")) {
    return { classifiedTag: tag, rule: null, aiUsed: true, confidence: 0.9, action: "escalated", escalationReason: "pricing", escalationTrigger: "מילים: יקר/הנחה ב-notes" };
  }
  if (notes.includes("עם סוכן") || notes.includes("רוצה לדבר") || notes.includes("לחץ תיאום שיחה")) {
    return { classifiedTag: tag, rule: null, aiUsed: true, confidence: 0.92, action: "escalated", escalationReason: "human_request", escalationTrigger: "ביקש שיחה אישית" };
  }
  if (lead.currentTag === null && lead.name === lead.subscriberId) {
    return { classifiedTag: null, rule: null, aiUsed: false, confidence: null, action: "escalated", escalationReason: "unknown", escalationTrigger: "ליד שבור — אין שם, אין תג" };
  }
  if (lead.quoteTotal && lead.quoteTotal >= 10000 && days >= 5) {
    return { classifiedTag: tag, rule: null, aiUsed: true, confidence: 0.88, action: "escalated", escalationReason: "low_confidence", escalationTrigger: `עסקה גדולה (${lead.quoteTotal} ש"ח), ${days} ימים שקט` };
  }
  if ((tag === "הצעה_בוט" || tag === "הצעה_טלפון" || tag === "ליד_חדש" || tag === "בתהליך") && days >= 5) {
    return { classifiedTag: "לא_ענה", rule: "no_contact_5days", aiUsed: false, confidence: 1.0, action: "tag_only" };
  }
  if (tag === "מעוניין" && days >= 5 && !lead.quoteTotal) {
    return { classifiedTag: "לא_ענה", rule: "interested_no_quote_5days", aiUsed: false, confidence: 0.95, action: "tag_only" };
  }
  return { classifiedTag: tag, rule: null, aiUsed: true, confidence: 0.5, action: "escalated", escalationReason: "low_confidence", escalationTrigger: "אין כלל ברור, Claude לא בטוחה" };
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.BOT_SECRET || auth !== `Bearer ${process.env.BOT_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [run] = await db.insert(botRuns).values({ status: "running" }).returning({ id: botRuns.id });
  const runId = run.id;

  let leadsSeen = 0;
  let decisionsCount = 0;
  let escalationsCount = 0;
  let errors = 0;
  const today = new Date();

  const activeLeads = await db.select({ id: leads.manychatSubId }).from(leads).where(eq(leads.active, true));
  const subscriberIds = activeLeads.map((r) => r.id);

  for (const sid of subscriberIds) {
    try {
      const sub = await getSubscriber(sid);
      const tagIds = sub.tags.map((t) => t.id);
      if (tagIds.some((id) => TERMINAL_TAGS.includes(id))) continue;

      leadsSeen++;
      const currentTag = tagIds.map((id) => tagIdToName[id]).filter(Boolean)[0] ?? null;
      const notes = getFieldValue(sub.custom_fields, "notes");
      const quoteTotal = getFieldValue(sub.custom_fields, "quote_total");
      const lastContact = getFieldValue(sub.custom_fields, "last_contact_date");

      let daysSinceContact: number | null = null;
      if (lastContact) {
        const lc = new Date(String(lastContact).slice(0, 10));
        daysSinceContact = Math.floor((today.getTime() - lc.getTime()) / 86400000);
      }

      const lead: Lead = {
        subscriberId: sid,
        name: sub.name ?? sid,
        currentTag,
        notes: notes ? String(notes) : null,
        quoteTotal: quoteTotal ? Number(quoteTotal) : null,
        daysSinceContact,
      };

      const outcome = applyRules(lead);

      const [dec] = await db
        .insert(decisions)
        .values({
          runId,
          manychatSubId: sid,
          leadName: lead.name,
          inputMessages: { notes: lead.notes, currentTag, daysSinceContact, quoteTotal: lead.quoteTotal },
          ruleMatched: outcome.rule,
          aiUsed: outcome.aiUsed,
          aiConfidence: outcome.confidence ? String(outcome.confidence) : null,
          classifiedTag: outcome.classifiedTag,
          prevTag: currentTag,
          actionTaken: outcome.action,
        })
        .returning({ id: decisions.id });
      decisionsCount++;

      if (outcome.action === "escalated") {
        await db.insert(escalations).values({
          decisionId: dec.id,
          manychatSubId: sid,
          leadName: lead.name,
          reason: outcome.escalationReason!,
          triggerText: outcome.escalationTrigger ?? null,
        });
        escalationsCount++;
      }
    } catch {
      errors++;
    }
  }

  await db
    .update(botRuns)
    .set({
      finishedAt: new Date(),
      leadsSeen,
      decisions: decisionsCount,
      escalations: escalationsCount,
      errors,
      status: errors === 0 ? "success" : "partial",
    })
    .where(eq(botRuns.id, runId));

  return NextResponse.json({
    ok: true,
    runId,
    leadsSeen,
    decisions: decisionsCount,
    escalations: escalationsCount,
    errors,
  });
}
