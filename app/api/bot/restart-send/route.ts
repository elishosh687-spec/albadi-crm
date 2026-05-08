/**
 * One-time batch sender — sends re-engagement WhatsApp templates to all stuck leads.
 * Called by Anthropic cloud routine on Sunday 11:00 AM Israel time.
 *
 * Security: requires Authorization: Bearer <BOT_SECRET> header.
 * Idempotent guard: skips subscribers that already received a template today.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSubscriber, getFieldValue } from "@/lib/manychat/client";
import { TAG_IDS, TERMINAL_TAGS, MANYCHAT_BASE, MANYCHAT_TOKEN } from "@/lib/manychat/config";
import { db } from "@/lib/db";
import { repliesSent } from "@/drizzle/schema";
import { gte } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 120;

const FLOW_NS: Record<string, string> = {
  TEMPLATE_FOLLOWUP_QUOTE_SENT:      "content20260508151701_091472",
  TEMPLATE_AFTER_HOLIDAY:            "content20260508152934_109626",
  TEMPLATE_PRICE_TOO_HIGH:           "content20260508180816_402346",
  TEMPLATE_CALL_REQUEST_FOLLOWUP:    "content20260508152941_860840",
  TEMPLATE_QUESTIONNAIRE_INCOMPLETE: "content20260508152940_284953",
  TEMPLATE_LAST_ATTEMPT:             "content20260508152938_498910",
};

const KNOWN_SUBSCRIBERS = [
  "1290975646", "335237336", "843866619", "1567115769", "2035644170",
  "1884294789", "1602697859", "933250256", "1945485008", "2121695200",
  "21902603", "342493590", "1342391971", "647013452", "235009133",
  "1109877399", "1233780185", "1168653412", "1745508158", "1559024601",
  "940287852", "969554152", "24594158", "1513055758", "1986772872",
  "3658499", "1890126495", "248319497", "221677737", "347894123",
  "869425808", "1768242677", "956589647", "771607363", "1720207271",
  "774945448", "1701651968", "1258938556", "306431271",
];

const tagIdToName: Record<number, string> = Object.fromEntries(
  Object.entries(TAG_IDS).map(([k, v]) => [v, k])
);

type GroupKey =
  | "high_value_quote_followup" | "quote_sent_followup" | "after_holiday"
  | "said_too_expensive" | "requested_call_no_answer" | "questionnaire_incomplete"
  | "already_marked_no_answer" | "broken_lead" | "manual_review";

const GROUP_TO_TEMPLATE: Record<GroupKey, string | null> = {
  high_value_quote_followup:  "TEMPLATE_FOLLOWUP_QUOTE_SENT",
  quote_sent_followup:        "TEMPLATE_FOLLOWUP_QUOTE_SENT",
  after_holiday:              "TEMPLATE_AFTER_HOLIDAY",
  said_too_expensive:         "TEMPLATE_PRICE_TOO_HIGH",
  requested_call_no_answer:   "TEMPLATE_CALL_REQUEST_FOLLOWUP",
  questionnaire_incomplete:   "TEMPLATE_QUESTIONNAIRE_INCOMPLETE",
  already_marked_no_answer:   "TEMPLATE_LAST_ATTEMPT",
  broken_lead:                null,
  manual_review:              null,
};

function classify(lead: { currentTag: string | null; name: string; subscriberId: string; notes: string | null; quoteTotal: number | null }): GroupKey {
  const notes = (lead.notes || "").toLowerCase();
  const tag = lead.currentTag;
  if (lead.currentTag === null && lead.name === lead.subscriberId) return "broken_lead";
  if (lead.quoteTotal && lead.quoteTotal >= 10000) return "high_value_quote_followup";
  if (notes.includes("יקר")) return "said_too_expensive";
  if (notes.includes("אחרי החג") || notes.includes("אחרי חג")) return "after_holiday";
  if (notes.includes("לחץ תיאום שיחה") || notes.includes("רוצה לדבר") || notes.includes("עם סוכן")) return "requested_call_no_answer";
  if (tag === "לא_ענה") return "already_marked_no_answer";
  if (tag === "ליד_חדש" || notes.includes("מילא חלקי") || notes.includes("לא מילא") || notes.includes("חלקי")) return "questionnaire_incomplete";
  if (lead.quoteTotal && lead.quoteTotal > 0) return "quote_sent_followup";
  if (tag === "הצעה_בוט" || tag === "הצעה_טלפון") return "quote_sent_followup";
  return "manual_review";
}

async function sendFlow(subscriberId: string, flowNs: string): Promise<string | null> {
  const res = await fetch(`${MANYCHAT_BASE}/sending/sendFlow`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MANYCHAT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ subscriber_id: subscriberId, flow_ns: flowNs }),
  });
  const json = (await res.json()) as { status: string; message?: string; data?: any };
  if (!res.ok || json.status !== "success") {
    throw new Error(`sendFlow failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json.data?.message_id ?? null;
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.BOT_SECRET || auth !== `Bearer ${process.env.BOT_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Idempotency: skip subs already sent to today
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const alreadySent = await db
    .select({ id: repliesSent.manychatSubId })
    .from(repliesSent)
    .where(gte(repliesSent.sentAt, todayStart));
  const alreadySentIds = new Set(alreadySent.map((r) => r.id));

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const sid of KNOWN_SUBSCRIBERS) {
    if (alreadySentIds.has(sid)) { skipped++; continue; }

    try {
      const sub = await getSubscriber(sid);
      const tagIds = sub.tags.map((t) => t.id);
      if (tagIds.some((id) => TERMINAL_TAGS.includes(id))) { skipped++; continue; }

      const currentTag = tagIds.map((id) => tagIdToName[id]).filter(Boolean)[0] ?? null;
      const notes = getFieldValue(sub.custom_fields, "notes");
      const quoteTotal = getFieldValue(sub.custom_fields, "quote_total");

      const lead = {
        subscriberId: sid,
        name: sub.name ?? sid,
        currentTag,
        notes: notes ? String(notes) : null,
        quoteTotal: quoteTotal ? Number(quoteTotal) : null,
      };

      const group = classify(lead);
      const templateEnv = GROUP_TO_TEMPLATE[group];
      if (!templateEnv) { skipped++; continue; }

      const flowNs = FLOW_NS[templateEnv];
      if (!flowNs) { skipped++; continue; }

      const msgId = await sendFlow(sid, flowNs);
      await db.insert(repliesSent).values({
        manychatSubId: sid,
        templateUsed: templateEnv,
        text: `restart-send flow:${flowNs} group:${group}`,
        manychatMsgId: msgId,
      });
      sent++;
    } catch (e: any) {
      failed++;
      failures.push(`${sid}: ${e.message}`);
    }

    await new Promise((r) => setTimeout(r, 500)); // light throttle — 2/sec
  }

  return NextResponse.json({ ok: true, sent, skipped, failed, failures });
}
