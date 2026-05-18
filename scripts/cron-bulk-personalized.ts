/**
 * Bulk personalized outreach — one-shot.
 *
 * For every active lead (excluding WON/DROPPED and test JID), use an LLM to
 * compose a 1-2 sentence Hebrew message tailored to the lead's context
 * (notes, recent thread, stage, qState), send via bridge, and log to
 * bot_decision_log. 5 minute gap between sends.
 *
 * Skips:
 *   - bot_paused (we don't override Eli's explicit pause)
 *   - last outbound from bot/eli within 24h (avoid spamming)
 *   - test JIDs
 *   - WON / DROPPED / WAITING_FACTORY (terminal or Eli-only stages)
 *
 * Run modes:
 *   --dry        print what WOULD be sent, no API calls, no DB writes
 *   --confirm    actually send
 *   (no flag)    dry-run by default
 */
import { db } from "../lib/db";
import { leads, messages, botDecisionLog } from "../drizzle/schema";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { sendBridgeMessage } from "../lib/bridge/client";
import { isTestJid } from "../lib/config/test-jids";

const DRY = !process.argv.includes("--confirm");
const GAP_MS = 5 * 60 * 1000;
const RECENT_OUT_WINDOW_MS = 24 * 60 * 60 * 1000;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

interface LeadRow {
  sid: string;
  name: string | null;
  phone: string | null;
  jid: string | null;
  stage: string | null;
  qState: any;
  notes: string | null;
  botSummary: string | null;
}

interface MsgRow {
  direction: "in" | "out";
  text: string;
  sender: string | null;
}

const SYSTEM_PROMPT = `אתה אלי, איש אריזות אלבדי. אתה כותב הודעה אישית קצרה ב-WhatsApp ללקוח/ה.

חוקים נוקשים:
- 1-2 משפטים בלבד. WhatsApp קצר.
- גוף ראשון יחיד ("אני"). פנייה ניטרלית לעסק (אתם/לכם), לא "אתה".
- 0-1 emoji.
- אסור להבטיח תאריך אספקה ספציפי או לצטט מחיר חדש.
- אם יש notes פנימיים שמאלי כתב, השתמש בהם להתאמה אישית (למשל "אמר ליצור איתו קשר ב-18.5" → התייחס לזה ספציפית).
- אם הליד באמצע שאלון — דחוף קלות להמשיך.
- אם קיבל הצעת מחיר ולא ענה — שאל אם נוח להמשיך.
- אם זה ליד חדש שלא דיבר — היכרות קצרה.

החזר JSON בלבד:
{ "message": "<הודעה בעברית>", "rationale": "<למה זה הניסוח הזה — באנגלית, קצר>" }`;

async function generateMessage(
  lead: LeadRow,
  recent: MsgRow[]
): Promise<{ message: string; rationale: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const contextLines: string[] = [];
  contextLines.push(`Lead: ${lead.name ?? "(no name)"}`);
  if (lead.phone) contextLines.push(`Phone: ${lead.phone}`);
  contextLines.push(`Stage: ${lead.stage ?? "(none)"}`);
  if (lead.notes) contextLines.push(`Eli notes: ${lead.notes.slice(0, 600)}`);
  if (lead.botSummary)
    contextLines.push(`Bot summary: ${lead.botSummary.slice(0, 400)}`);
  if (lead.qState) {
    const q = lead.qState as any;
    const parts: string[] = [];
    if (q.step) parts.push(`questionnaire step=${q.step}`);
    if (q.doneAt) parts.push(`quote_sent=true`);
    if (q.bailed) parts.push(`bailed=true`);
    if (parts.length) contextLines.push(`qState: ${parts.join(", ")}`);
  }
  contextLines.push("");
  contextLines.push("Recent thread (oldest first, max 15):");
  if (recent.length === 0) {
    contextLines.push("(no prior messages — cold lead)");
  } else {
    for (const m of recent) {
      const who =
        m.direction === "in" ? "Customer" : m.sender === "eli" ? "Eli" : "Bot";
      contextLines.push(`${who}: ${m.text.slice(0, 200)}`);
    }
  }
  contextLines.push("");
  contextLines.push("Return JSON only.");

  const res = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.5,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: contextLines.join("\n") },
      ],
    }),
  });
  if (!res.ok) {
    console.warn("LLM non-2xx", res.status);
    return null;
  }
  const data: any = await res.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed.message !== "string" || !parsed.message.trim())
      return null;
    return {
      message: parsed.message.trim().slice(0, 600),
      rationale:
        typeof parsed.rationale === "string"
          ? parsed.rationale.slice(0, 300)
          : "",
    };
  } catch {
    return null;
  }
}

async function loadRecent(sid: string): Promise<MsgRow[]> {
  const rows = await db
    .select({
      direction: messages.direction,
      text: messages.text,
      sender: messages.sender,
    })
    .from(messages)
    .where(eq(messages.manychatSubId, sid.trim()))
    .orderBy(desc(messages.receivedAt))
    .limit(15);
  return rows
    .filter((r) => r.text && r.text.trim().length > 0)
    .map((r) => ({
      direction: r.direction as "in" | "out",
      text: r.text!,
      sender: r.sender as string | null,
    }))
    .reverse();
}

async function lastOutboundAt(sid: string): Promise<Date | null> {
  const [row] = await db
    .select({ receivedAt: messages.receivedAt })
    .from(messages)
    .where(
      and(
        eq(messages.manychatSubId, sid.trim()),
        eq(messages.direction, "out")
      )
    )
    .orderBy(desc(messages.receivedAt))
    .limit(1);
  return row?.receivedAt ?? null;
}

async function main() {
  console.log(`\n=== bulk personalized outreach ===`);
  console.log(`mode: ${DRY ? "DRY RUN" : "CONFIRM (will send + log)"}`);
  console.log(`gap between sends: 5 min`);
  console.log("");

  const candidates = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      jid: leads.waJid,
      stage: leads.pipelineStage,
      qState: leads.qState,
      notes: leads.notes,
      botSummary: leads.botSummary,
      botPaused: leads.botPaused,
    })
    .from(leads)
    .where(eq(leads.active, true));

  const eligible: LeadRow[] = [];
  for (const r of candidates) {
    const stage = (r.stage ?? "").toUpperCase();
    if (stage === "WON" || stage === "DROPPED" || stage === "WAITING_FACTORY") continue;
    if (r.botPaused) continue;
    const recipient = r.jid || r.sid;
    if (isTestJid(recipient)) continue;
    if (!r.jid && !r.phone) continue; // can't send

    const last = await lastOutboundAt(r.sid);
    if (last && Date.now() - last.getTime() < RECENT_OUT_WINDOW_MS) {
      console.log(`SKIP ${r.name ?? r.sid} — outbound in last 24h`);
      continue;
    }
    eligible.push({
      sid: r.sid,
      name: r.name,
      phone: r.phone,
      jid: r.jid,
      stage: r.stage,
      qState: r.qState,
      notes: r.notes,
      botSummary: r.botSummary,
    });
  }

  console.log(`\nEligible leads: ${eligible.length}\n`);
  if (eligible.length === 0) {
    console.log("nothing to send");
    process.exit(0);
  }

  let sent = 0;
  let failed = 0;
  let consecutiveFailures = 0;

  for (let i = 0; i < eligible.length; i++) {
    const lead = eligible[i];
    const who = lead.name?.trim() || lead.phone || lead.sid;
    console.log(`\n[${i + 1}/${eligible.length}] ${who} (stage=${lead.stage})`);

    let recent: MsgRow[] = [];
    let generated: { message: string; rationale: string } | null = null;
    try {
      recent = await loadRecent(lead.sid);
      generated = await generateMessage(lead, recent);
    } catch (e) {
      console.warn("  context/LLM error:", e);
    }

    if (!generated) {
      console.log("  ⚠ LLM did not produce a message — skipping");
      failed++;
      consecutiveFailures++;
      if (consecutiveFailures >= 3) {
        console.error("\n3 consecutive failures — aborting");
        process.exit(1);
      }
      continue;
    }
    console.log(`  → "${generated.message}"`);
    console.log(`    rationale: ${generated.rationale}`);

    if (DRY) {
      sent++;
      consecutiveFailures = 0;
      // No sleep in dry mode — fast preview.
      continue;
    }

    const recipient = lead.jid || `${lead.phone!.replace(/[^0-9]/g, "")}@s.whatsapp.net`;
    try {
      await sendBridgeMessage(recipient, generated.message, undefined, "eli");
      sent++;
      consecutiveFailures = 0;
      // Best-effort log row
      try {
        await db.insert(botDecisionLog).values({
          manychatSubId: lead.sid,
          inboundText: null,
          stageBefore: lead.stage,
          stageAfter: lead.stage,
          decidedBy: "code",
          action: "reply_sent",
          replyText: generated.message,
          metadata: {
            trigger: "bulk_personalized_cron",
            rationale: generated.rationale,
            model: "gpt-4o-mini",
          } as any,
        });
      } catch (e) {
        console.warn("  log write failed (non-fatal):", e);
      }
    } catch (e) {
      console.error("  ✗ send failed:", e);
      failed++;
      consecutiveFailures++;
      if (consecutiveFailures >= 3) {
        console.error("\n3 consecutive failures — aborting");
        process.exit(1);
      }
    }

    if (i < eligible.length - 1) {
      console.log(`  ⏱ sleeping 5 min before next…`);
      await new Promise((r) => setTimeout(r, GAP_MS));
    }
  }

  console.log(`\n=== done ===`);
  console.log(`sent:   ${sent}`);
  console.log(`failed: ${failed}`);
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
