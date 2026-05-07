/**
 * Restart-mode batch sender. Re-runs the restart-mode classification,
 * maps each lead to the right template, and sends in 5/minute throttle.
 *
 * Default mode: --dry-run. Shows exactly what would be sent. NO send.
 * To actually send: pass --confirm.
 *
 * Usage:
 *   npm run bot:restart-send                 # dry run (default)
 *   npm run bot:restart-send -- --confirm    # actually send
 */
import "dotenv/config";
import { getSubscriber, getFieldValue } from "../lib/manychat/client";
import { TAG_IDS, TERMINAL_TAGS, MANYCHAT_BASE, MANYCHAT_TOKEN } from "../lib/manychat/config";
import { db } from "../lib/db";
import { repliesSent } from "../drizzle/schema";

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
}

type GroupKey =
  | "high_value_quote_followup"      // > 10K — ALSO gets template per Eli's request
  | "quote_sent_followup"
  | "after_holiday"
  | "said_too_expensive"
  | "requested_call_no_answer"
  | "questionnaire_incomplete"
  | "already_marked_no_answer"
  | "broken_lead"
  | "manual_review";

const GROUP_TO_TEMPLATE_ENV: Record<GroupKey, string | null> = {
  high_value_quote_followup: "TEMPLATE_FOLLOWUP_QUOTE_SENT",
  quote_sent_followup: "TEMPLATE_FOLLOWUP_QUOTE_SENT",
  after_holiday: "TEMPLATE_AFTER_HOLIDAY",
  said_too_expensive: "TEMPLATE_PRICE_TOO_HIGH",
  requested_call_no_answer: "TEMPLATE_CALL_REQUEST_FOLLOWUP",
  questionnaire_incomplete: "TEMPLATE_QUESTIONNAIRE_INCOMPLETE",
  already_marked_no_answer: "TEMPLATE_LAST_ATTEMPT",
  broken_lead: null,
  manual_review: null,
};

function classify(lead: Lead): GroupKey {
  const notes = (lead.notes || "").toLowerCase();
  const tag = lead.currentTag;

  if (lead.currentTag === null && lead.name === lead.subscriberId) {
    return "broken_lead";
  }

  if (lead.quoteTotal && lead.quoteTotal >= 10000) {
    return "high_value_quote_followup";
  }

  if (notes.includes("יקר")) {
    return "said_too_expensive";
  }

  if (notes.includes("אחרי החג") || notes.includes("אחרי חג")) {
    return "after_holiday";
  }

  if (notes.includes("לחץ תיאום שיחה") || notes.includes("רוצה לדבר") || notes.includes("עם סוכן")) {
    return "requested_call_no_answer";
  }

  if (tag === "לא_ענה") {
    return "already_marked_no_answer";
  }

  if (
    tag === "ליד_חדש" ||
    notes.includes("מילא חלקי") ||
    notes.includes("לא מילא") ||
    notes.includes("חלקי")
  ) {
    return "questionnaire_incomplete";
  }

  if (lead.quoteTotal && lead.quoteTotal > 0) {
    return "quote_sent_followup";
  }

  if (tag === "הצעה_בוט" || tag === "הצעה_טלפון") {
    return "quote_sent_followup";
  }

  return "manual_review";
}

function buildVars(group: GroupKey, lead: Lead): Record<string, string> {
  // Template 1 (followup_quote_sent): {{1}}=quote, {{2}}=name
  if (group === "quote_sent_followup" || group === "high_value_quote_followup") {
    return {
      "1": String(lead.quoteTotal ?? 0),
      "2": lead.name.split(" ")[0],
    };
  }
  // Templates 2-6: {{1}}=name only
  return { "1": lead.name.split(" ")[0] };
}

async function sendTemplate(
  subscriberId: string,
  templateId: string,
  vars: Record<string, string>
): Promise<string | null> {
  const res = await fetch(`${MANYCHAT_BASE}/sending/sendContent`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MANYCHAT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      subscriber_id: subscriberId,
      data: {
        version: "v2",
        content: {
          messages: [
            {
              type: "whatsapp_template",
              template_id: templateId,
              variables: vars,
            },
          ],
        },
      },
    }),
  });
  const json = (await res.json()) as { status: string; message?: string; data?: any };
  if (!res.ok || json.status !== "success") {
    throw new Error(`ManyChat send failed: ${res.status} ${JSON.stringify(json)}`);
  }
  return json.data?.message_id ?? null;
}

async function main() {
  const confirm = process.argv.includes("--confirm");
  const dryRun = !confirm;

  // 1. Pull leads
  console.log("Pulling leads from ManyChat...");
  const leads: Lead[] = [];
  for (const sid of KNOWN_SUBSCRIBERS) {
    try {
      const sub = await getSubscriber(sid);
      const tagIds = sub.tags.map((t) => t.id);
      if (tagIds.some((id) => TERMINAL_TAGS.includes(id))) continue;
      const currentTag = tagIds.map((id) => tagIdToName[id]).filter(Boolean)[0] ?? null;
      const notes = getFieldValue(sub.custom_fields, "notes");
      const quoteTotal = getFieldValue(sub.custom_fields, "quote_total");
      leads.push({
        subscriberId: sid,
        name: sub.name ?? sid,
        currentTag,
        notes: notes ? String(notes) : null,
        quoteTotal: quoteTotal ? Number(quoteTotal) : null,
      });
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`Pulled ${leads.length} active leads.\n`);

  // 2. Classify + plan sends
  type Plan = { lead: Lead; group: GroupKey; templateEnv: string | null; vars: Record<string, string> };
  const plans: Plan[] = leads.map((lead) => {
    const group = classify(lead);
    const templateEnv = GROUP_TO_TEMPLATE_ENV[group];
    const vars = templateEnv ? buildVars(group, lead) : {};
    return { lead, group, templateEnv, vars };
  });

  // 3. Print plan
  console.log(`${dryRun ? "🟡 DRY RUN" : "🟢 SENDING FOR REAL"} — plan:\n`);
  const willSend = plans.filter((p) => p.templateEnv !== null);
  const willSkip = plans.filter((p) => p.templateEnv === null);

  for (const p of willSend) {
    const templateId = process.env[p.templateEnv!] || "<NOT_SET_IN_ENV>";
    const ready = templateId !== "<NOT_SET_IN_ENV>" ? "✓" : "✗";
    console.log(
      `  ${ready} [${p.group}] ${p.lead.name}  →  ${p.templateEnv}  vars=${JSON.stringify(p.vars)}`
    );
  }
  console.log(`\nSkip (no template): ${willSkip.length}`);
  for (const p of willSkip) {
    console.log(`  • ${p.lead.name} [${p.group}]`);
  }

  // 4. Validate ENV
  const missing = willSend.filter((p) => !process.env[p.templateEnv!]);
  if (missing.length > 0) {
    console.log(
      `\n❌ ${missing.length} templates not yet approved or ENV not filled. Cannot proceed.`
    );
    console.log("Templates missing:");
    for (const m of missing) {
      console.log(`  - ${m.templateEnv}`);
    }
    process.exit(1);
  }

  if (dryRun) {
    console.log(`\n🟡 Dry run complete. Pass --confirm to actually send.`);
    return;
  }

  // 5. Send (5/min throttle = 12 sec between sends)
  console.log(`\n🟢 Sending ${willSend.length} templates at 5/min...\n`);
  let sent = 0;
  let failed = 0;
  for (const p of willSend) {
    const templateId = process.env[p.templateEnv!]!;
    try {
      const msgId = await sendTemplate(p.lead.subscriberId, templateId, p.vars);
      await db.insert(repliesSent).values({
        manychatSubId: p.lead.subscriberId,
        templateUsed: p.templateEnv!,
        text: `${p.group}: ${JSON.stringify(p.vars)}`,
        manychatMsgId: msgId,
      });
      console.log(`  ✓ ${p.lead.name} (${p.templateEnv})`);
      sent++;
    } catch (e: any) {
      console.log(`  ✗ ${p.lead.name} — ${e.message}`);
      failed++;
    }
    await new Promise((r) => setTimeout(r, 12_000));
  }

  console.log(`\nDone. Sent: ${sent}  Failed: ${failed}  Skipped: ${willSkip.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
