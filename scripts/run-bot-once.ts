/**
 * Run the bot once — Phase 1 (read-only).
 *
 * Pulls all active leads, classifies via code rules, writes decisions to DB.
 * Does NOT call ManyChat to update tags — read-only mode.
 * Escalations are saved to DB for review.
 *
 * Run: npm run bot:run-once
 */
import "dotenv/config";
import { getSubscriber, getFieldValue } from "../lib/manychat/client";
import { TAG_IDS, TERMINAL_TAGS } from "../lib/manychat/config";
import { db } from "../lib/db";
import { botRuns, decisions, escalations } from "../drizzle/schema";
import { eq } from "drizzle-orm";

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

interface Lead {
  subscriberId: string;
  name: string;
  currentTag: string | null;
  notes: string | null;
  quoteTotal: number | null;
  followUp: string | null;
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

  // Hard rule: in stable terminal-ish state — no action
  if (tag === "לא_ענה" && days < 7) {
    return { classifiedTag: tag, rule: "no_action_stable", aiUsed: false, confidence: 1.0, action: "no_action" };
  }

  // Pricing escalation
  if (notes.includes("הנחה") || notes.includes("יקר")) {
    return {
      classifiedTag: tag,
      rule: null,
      aiUsed: true,
      confidence: 0.9,
      action: "escalated",
      escalationReason: "pricing",
      escalationTrigger: "מילים: יקר/הנחה ב-notes",
    };
  }

  // Human request escalation
  if (notes.includes("עם סוכן") || notes.includes("רוצה לדבר") || notes.includes("לחץ תיאום שיחה")) {
    return {
      classifiedTag: tag,
      rule: null,
      aiUsed: true,
      confidence: 0.92,
      action: "escalated",
      escalationReason: "human_request",
      escalationTrigger: "ביקש שיחה אישית",
    };
  }

  // Broken lead
  if (lead.currentTag === null && lead.name === lead.subscriberId) {
    return {
      classifiedTag: null,
      rule: null,
      aiUsed: false,
      confidence: null,
      action: "escalated",
      escalationReason: "unknown",
      escalationTrigger: "ליד שבור — אין שם, אין תג",
    };
  }

  // High value waiting — escalate
  if (lead.quoteTotal && lead.quoteTotal >= 10000 && days >= 5) {
    return {
      classifiedTag: tag,
      rule: null,
      aiUsed: true,
      confidence: 0.88,
      action: "escalated",
      escalationReason: "low_confidence",
      escalationTrigger: `עסקה גדולה (${lead.quoteTotal} ש"ח), ${days} ימים שקט`,
    };
  }

  // No-contact rule (5+ days silent on quote-sent or holding tags)
  if (
    (tag === "הצעה_בוט" || tag === "הצעה_טלפון" || tag === "ליד_חדש" || tag === "בתהליך") &&
    days >= 5
  ) {
    return {
      classifiedTag: "לא_ענה",
      rule: "no_contact_5days",
      aiUsed: false,
      confidence: 1.0,
      action: "tag_only",
    };
  }

  // No-quote interested 5+ days
  if (tag === "מעוניין" && days >= 5 && !lead.quoteTotal) {
    return {
      classifiedTag: "לא_ענה",
      rule: "interested_no_quote_5days",
      aiUsed: false,
      confidence: 0.95,
      action: "tag_only",
    };
  }

  // No clear rule — escalate as low confidence
  return {
    classifiedTag: tag,
    rule: null,
    aiUsed: true,
    confidence: 0.5,
    action: "escalated",
    escalationReason: "low_confidence",
    escalationTrigger: "אין כלל ברור, Claude לא בטוחה",
  };
}

async function main() {
  console.log("Phase 1 read-only — starting run.\n");

  // 1. Create run row
  const [run] = await db
    .insert(botRuns)
    .values({ status: "running" })
    .returning({ id: botRuns.id });
  const runId = run.id;
  console.log(`Created run #${runId}\n`);

  let leadsSeen = 0;
  let decisionsCount = 0;
  let escalationsCount = 0;
  let errors = 0;
  const today = new Date();

  // 2. Pull each subscriber + classify
  for (const sid of KNOWN_SUBSCRIBERS) {
    try {
      const sub = await getSubscriber(sid);
      const tagIds = sub.tags.map((t) => t.id);
      if (tagIds.some((id) => TERMINAL_TAGS.includes(id))) continue;

      leadsSeen++;
      const currentTag = tagIds.map((id) => tagIdToName[id]).filter(Boolean)[0] ?? null;
      const notes = getFieldValue(sub.custom_fields, "notes");
      const quoteTotal = getFieldValue(sub.custom_fields, "quote_total");
      const followUp = getFieldValue(sub.custom_fields, "follow_up_date");
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
        followUp: followUp ? String(followUp) : null,
        daysSinceContact,
      };

      const outcome = applyRules(lead);

      // Save decision
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

      // Save escalation if needed
      if (outcome.action === "escalated") {
        await db.insert(escalations).values({
          decisionId: dec.id,
          manychatSubId: sid,
          leadName: lead.name,
          reason: outcome.escalationReason!,
          triggerText: outcome.escalationTrigger ?? null,
        });
        escalationsCount++;
        console.log(`  🟡 ${lead.name} → escalation (${outcome.escalationReason})`);
      } else if (outcome.action === "tag_only") {
        console.log(`  ✓ ${lead.name} → ${outcome.classifiedTag} (rule: ${outcome.rule}) [READ-ONLY: not applied to ManyChat]`);
      } else {
        console.log(`  · ${lead.name} → no action (${outcome.rule})`);
      }
    } catch (e: any) {
      errors++;
      console.log(`  ✗ ${sid} — ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  // 3. Update run row
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

  console.log(`\n=== Run #${runId} complete ===`);
  console.log(`Leads seen:    ${leadsSeen}`);
  console.log(`Decisions:     ${decisionsCount}`);
  console.log(`Escalations:   ${escalationsCount}`);
  console.log(`Errors:        ${errors}`);
  console.log(`\nView dashboard: npm run dev → http://localhost:3000/dashboard`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
