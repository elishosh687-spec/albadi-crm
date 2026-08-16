/**
 * Follow-up cron — the nudges a customer gets when they go quiet.
 *
 * TRIGGER: `.github/workflows/followups.yml`, every 15 minutes. vercel.json
 * also points here once a day as a safety net. It used to be Vercel ONLY, and
 * because that plan runs crons once a day the cadence below could never
 * actually happen — 56 of the 65 leads ever followed up got exactly one nudge.
 * Overlapping triggers are safe: the run claims a row in app_config first.
 *
 * CADENCE AND CAP ARE SETTINGS (`followupCadence*`, `followupMaxAttempts`) —
 * see lib/autoresponder/followup-cadence.ts, which clamps every value so a
 * typo like "0" can't turn a nudge into a spam loop. The match predicates stay
 * in code: they encode which pipeline state a lead is in, which is structure,
 * not policy.
 *
 * Per docs/CUSTOMER-FLOW.md (8-stage model):
 *   - Gates: master toggle, quiet hours (21:00-09:00 Asia/Jerusalem), no-send
 *     days (Fri/Sat/holiday-eve/holiday via Hebcal).
 *   - Customer-side cadence by stage, defaults in hours:
 *       (pre-quote, mid-questionnaire abandoned)  → 1, 1, 1
 *       INTAKE                                    → 2, 12, 23
 *       FACTORY_WAIT (subFlow=awaiting_logo)      → 2, 12, 23
 *       CONSIDERATION                             → 2, 12, 23
 *       NO_RESPONSE_REENGAGE                      → 72, repeating, uncapped
 *   - FACTORY_WAIT (subFlow=awaiting_factory_estimate) → Eli-only daily reminder.
 *   - After the configured attempts → escalate (NEEDS_ELI + bot_paused + DM).
 *   - Skips leads where bot_paused=true.
 *
 * Auth: Bearer BOT_SECRET / CRON_SECRET.
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads, messages } from "@/drizzle/schema";
import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { isQuietNow } from "@/lib/clock/quiet-hours";
import { isNoSendDay } from "@/lib/clock/hebcal";
import { sendBridgeMessage } from "@/lib/bridge/client";
import {
  followupTemplate,
  eliEscalationTemplate,
  eliFactoryReminderTemplate,
  type FollowupStage,
} from "@/lib/messaging/templates";
import { sendEliDM } from "@/lib/notify/eli";
import { loadSheetGaps } from "@/lib/sheets/lead-gaps";
import { superviseFollowup } from "@/lib/supervisor/followup-supervisor";
import { logDecision } from "@/lib/supervisor/log";
import { generateAndQueueDraft } from "@/lib/drafts";
import { syncLeadToGHL } from "@/integrations/ghl/sync";
import { pauseFields } from "@/lib/autoresponder/bot-pause";
import { getBotSettings } from "@/lib/bot-settings/store";
import type { BotSettings } from "@/lib/bot-settings/schema";
import { parseCadence, toMs } from "@/lib/autoresponder/followup-cadence";
import { composeSetterFollowup } from "@/lib/setter/followup";

export const runtime = "nodejs";
export const maxDuration = 60;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Fallback only — the live value comes from settings (followupMaxAttempts). */
const MAX_FOLLOWUPS_FALLBACK = 3;

interface StageRule {
  match: (pipelineStage: string | null, qState: any) => boolean;
  /** Wait BEFORE attempt #N. cadences[0] = wait before 1st follow-up, etc.
   *  When `unbounded=true`, the cron repeatedly applies the LAST cadence
   *  value indefinitely. */
  cadences: number[];
  template: FollowupStage;
  /** When true, the MAX_FOLLOWUPS=3 cap is bypassed and the cadence keeps
   *  repeating until the customer replies, opts out, or Eli moves the lead
   *  manually. Used for the NO_RESPONSE_REENGAGE re-engagement loop. */
  unbounded?: boolean;
}

/**
 * The cadences are settings now, so the rule table is built per request rather
 * than frozen at module load — otherwise a warm lambda would keep serving the
 * cadence that was current when it booted, and an edit would appear to do
 * nothing for as long as that instance lived.
 *
 * The `match` predicates stay hardcoded: they encode which pipeline state a
 * lead is in, which is structure, not policy.
 */
function buildStageRules(S: BotSettings): StageRule[] {
  const cad = (raw: string, fallbackHours: number[]) =>
    toMs(parseCadence(raw, fallbackHours).hours);
  return STAGE_RULE_SHAPES.map((shape) => ({
    ...shape,
    cadences: cad(S[shape.settingKey] as string, shape.fallbackHours),
  }));
}

type StageRuleShape = Omit<StageRule, "cadences"> & {
  settingKey: keyof BotSettings;
  fallbackHours: number[];
};

const STAGE_RULE_SHAPES: StageRuleShape[] = [
  {
    // Pre-quote (pipeline_stage IS NULL) + questionnaire in-flight (started, not done, not bailed).
    match: (stage, q) => {
      const s = (stage || "").toUpperCase();
      if (s !== "") return false;
      if (!q) return false;
      if (q.bailed || q.doneAt) return false;
      return typeof q.step === "number" && q.step >= 2 && q.step <= 7;
    },
    settingKey: "followupCadenceMidQuestionnaire",
    fallbackHours: [1, 1, 1],
    template: "MID_QUESTIONNAIRE",
  },
  {
    // INTAKE — bot waiting on customer reply to estimated quote.
    // Cadence per Eli: 2h → 12h → 23h. 3 nudges spread over ~37h total.
    match: (stage) => (stage || "").toUpperCase() === "INTAKE",
    settingKey: "followupCadenceIntake",
    fallbackHours: [2, 12, 23],
    template: "INTAKE",
  },
  {
    // FACTORY_WAIT (subFlow=awaiting_logo) — bot waiting on logo file.
    match: (stage, q) =>
      (stage || "").toUpperCase() === "FACTORY_WAIT" &&
      (q?.subFlow === "awaiting_logo" || !q?.subFlow),
    settingKey: "followupCadenceAwaitingLogo",
    fallbackHours: [2, 12, 23],
    template: "AWAITING_LOGO",
  },
  {
    // CONSIDERATION — bot waiting on customer reply to final price.
    match: (stage) => (stage || "").toUpperCase() === "CONSIDERATION",
    settingKey: "followupCadenceConsideration",
    fallbackHours: [2, 12, 23],
    template: "CONSIDERATION",
  },
  {
    // NO_RESPONSE_REENGAGE — Eli manually drags leads here after 3 calls +
    // 3 messages without a reply. Bot nudges every 3 days with an
    // LLM-personalized message (see lib/autoresponder/re-engagement.ts).
    // Quiet hours + Sabbath/holiday gate already applied globally below.
    // Unbounded: keeps running until customer replies, opts out via stop
    // word ("הסר" etc → webhook moves stage to LOST), or Eli moves the
    // opp himself.
    match: (stage) => (stage || "").toUpperCase() === "NO_RESPONSE_REENGAGE",
    settingKey: "followupCadenceReengage",
    fallbackHours: [72],
    template: "RE_ENGAGEMENT",
    unbounded: true,
  },
];

function pickRule(
  rules: StageRule[],
  pipelineStage: string | null,
  qState: any
): StageRule | null {
  for (const r of rules) {
    if (r.match(pipelineStage, qState)) return r;
  }
  return null;
}

interface ProcessedLead {
  sid: string;
  action: "sent" | "escalated" | "skipped_paused" | "skipped_cadence" | "no_rule" | "error";
  detail?: string;
}

async function escalateLead(input: {
  sid: string;
  name: string | null;
  phone: string | null;
  stage: string | null;
  reason: "no_reply" | "stop_word" | "bail";
}): Promise<void> {
  await db
    .update(leads)
    .set({
      pipelineFlag: "NEEDS_ELI",
      // stop_word is an opt-out and must never expire; the other two mean the
      // customer went cold, and resuming would just restart the nagging.
      ...pauseFields(input.reason === "stop_word" ? "opt_out" : "no_reply"),
    })
    .where(sql`trim(${leads.manychatSubId}) = ${input.sid.trim()}`);
  await sendEliDM(
    eliEscalationTemplate({
      name: input.name,
      phone: input.phone,
      stage: input.stage,
      reason: input.reason,
    })
  );
}

async function processCustomerLead(row: {
  sid: string;
  jid: string | null;
  name: string | null;
  phone: string | null;
  pipelineStage: string | null;
  qState: any;
  followUpCount: number;
  lastFollowUpAt: Date | null;
  botPaused: boolean;
  notes: string | null;
  botSummary: string | null;
}, cfg: {
  rules: StageRule[];
  maxFollowups: number;
}): Promise<ProcessedLead> {
  if (row.botPaused) {
    return { sid: row.sid, action: "skipped_paused" };
  }

  const maxFollowups = cfg.maxFollowups;
  const rule = pickRule(cfg.rules, row.pipelineStage, row.qState);
  if (!rule) {
    return { sid: row.sid, action: "no_rule" };
  }

  // HARD LIMIT — the configured attempt cap; the supervisor cannot override
  // it. Skipped for rules that opted into `unbounded` (re-engagement loop,
  // runs forever until the customer replies or Eli moves the lead).
  if (!rule.unbounded && row.followUpCount >= maxFollowups) {
    await escalateLead({
      sid: row.sid,
      name: row.name,
      phone: row.phone,
      stage: row.pipelineStage,
      reason: "no_reply",
    });
    await logDecision({
      manychatSubId: row.sid,
      stageBefore: row.pipelineStage,
      decidedBy: "code",
      action: "escalated",
      escalationKind: "max_followups",
      metadata: { attempt: row.followUpCount, max: maxFollowups },
    });
    return { sid: row.sid, action: "escalated", detail: "count>=max" };
  }

  const now = Date.now();
  const cadenceIdx = Math.min(row.followUpCount, rule.cadences.length - 1);
  const waitMs = rule.cadences[cadenceIdx];
  if (row.lastFollowUpAt) {
    const elapsed = now - row.lastFollowUpAt.getTime();
    if (elapsed < waitMs) {
      return { sid: row.sid, action: "skipped_cadence" };
    }
  }

  const recipient = row.jid || row.sid;
  const attempt = row.followUpCount + 1;
  // Re-engagement loop bodies are LLM-built per send so the message reflects
  // each lead's specific history + notes; the static template here only
  // serves as a fallback if the LLM is unavailable.
  let candidateText: string;
  if (rule.template === "RE_ENGAGEMENT") {
    const { buildReEngagementMessage } = await import("@/lib/autoresponder/re-engagement");
    const built = await buildReEngagementMessage(row.sid);
    candidateText = built.text;
  } else {
    // The canned line is resolved FIRST and always — it is the floor. The
    // setter is then given a chance to write something that actually reflects
    // this lead's conversation, and anything short of a valid message leaves
    // the floor in place. A customer never misses a nudge because the LLM had
    // a bad minute.
    candidateText = followupTemplate(rule.template, attempt);
    const authored = await composeSetterFollowup({
      sid: row.sid,
      stage: rule.template,
      attempt,
    });
    if (authored) candidateText = authored.text;
  }

  // Load recent thread for supervisor context.
  const recentRows = await db
    .select({
      direction: messages.direction,
      text: messages.text,
      sender: messages.sender,
    })
    .from(messages)
    .where(eq(messages.manychatSubId, row.sid.trim()))
    .orderBy(desc(messages.receivedAt))
    .limit(15);
  const recent = recentRows
    .filter((r) => r.text && r.text.trim().length > 0)
    .map((r) => ({
      direction: r.direction as "in" | "out",
      text: r.text!,
      sender: r.sender as string | null,
    }))
    .reverse();

  const gapHours = row.lastFollowUpAt
    ? (now - row.lastFollowUpAt.getTime()) / (60 * 60 * 1000)
    : null;

  const verdict = await superviseFollowup({
    sid: row.sid,
    jid: recipient,
    leadName: row.name,
    phone: row.phone,
    stage: row.pipelineStage,
    qState: row.qState,
    recentMessages: recent,
    templateLabel: rule.template,
    attempt,
    cadenceMs: waitMs,
    gapHours,
    candidateTemplate: candidateText,
    notes: row.notes,
    botSummary: row.botSummary,
  });

  const replayMeta = {
    prompt_version: verdict.promptVersion,
    model: verdict.model,
    template_label: rule.template,
    attempt,
    cadence_ms: waitMs,
    gap_hours: gapHours,
    candidate_template: candidateText,
    trigger: "followup_cron",
  };

  const logBase = {
    manychatSubId: row.sid,
    stageBefore: row.pipelineStage,
    llmConfidence: verdict.confidence,
    llmRecommended: verdict.recommended as any,
    llmReason: verdict.reason,
    llmRiskFlags: verdict.riskFlags,
  };

  // --- Execute verdict ---

  if (verdict.recommended === "supervisor_error") {
    // DM already sent inside supervisor. No state change.
    await logDecision({
      ...logBase,
      decidedBy: "supervisor_error",
      action: "no_op",
      metadata: { ...replayMeta, rawJson: verdict.rawJson },
    });
    return { sid: row.sid, action: "error", detail: verdict.reason };
  }

  if (verdict.recommended === "silence") {
    // Skip this cycle. Don't consume attempt — bump lastFollowUpAt so we don't
    // immediately retry on the next cron tick, but DO NOT increment followUpCount.
    await db
      .update(leads)
      .set({
        lastFollowUpAt: new Date(now),
        updatedAt: new Date(now),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${row.sid.trim()}`);
    await logDecision({
      ...logBase,
      decidedBy: "silent",
      action: "no_op",
      metadata: { ...replayMeta, rawJson: verdict.rawJson, note: "supervisor said silence — attempt NOT consumed" },
    });
    return { sid: row.sid, action: "skipped_cadence", detail: "supervisor_silence" };
  }

  if (verdict.recommended === "escalate_to_eli") {
    let draftId: number | null = null;
    try {
      draftId = await generateAndQueueDraft({
        manychatSubId: row.sid,
        moneyReason: "manual",
        pipelineStage: row.pipelineStage,
        leadName: row.name,
        botSummary: verdict.reason,
      });
    } catch (e) {
      console.error("[followups] draft generation failed", e);
    }
    try {
      const who = row.name?.trim() || row.phone || row.sid;
      await sendEliDM(
        `🤖 Followup supervisor escalation — ${who} (stage=${row.pipelineStage ?? "?"}, attempt ${attempt})\n` +
          `Reason: ${verdict.reason}\n` +
          (draftId ? `Draft #${draftId} ready in /dashboard/v3/drafts` : "Draft generation failed — handle manually.")
      );
    } catch (e) {
      console.error("[followups] eli DM failed", e);
    }
    // Mark as escalated state on the lead.
    await escalateLead({
      sid: row.sid,
      name: row.name,
      phone: row.phone,
      stage: row.pipelineStage,
      reason: "no_reply",
    });
    await logDecision({
      ...logBase,
      decidedBy: "code",
      action: draftId ? "draft_queued" : "escalated",
      escalationKind: "supervisor_decision",
      draftId,
      metadata: { ...replayMeta, rawJson: verdict.rawJson },
    });
    return { sid: row.sid, action: "escalated", detail: "supervisor_escalation" };
  }

  // approve_template or override_with_text — actually send.
  let textToSend: string;
  let decidedBy: "code" | "llm_override";
  if (verdict.recommended === "override_with_text" && verdict.overrideText) {
    textToSend = verdict.overrideText;
    decidedBy = "llm_override";
  } else {
    textToSend = candidateText;
    decidedBy = "code";
  }

  try {
    await sendBridgeMessage(recipient, textToSend);
  } catch (e) {
    await logDecision({
      ...logBase,
      decidedBy,
      action: "no_op",
      replyText: textToSend,
      metadata: { ...replayMeta, rawJson: verdict.rawJson, sendError: (e as Error).message },
    });
    return {
      sid: row.sid,
      action: "error",
      detail: (e as Error).message,
    };
  }

  await db
    .update(leads)
    .set({
      followUpCount: attempt,
      lastFollowUpAt: new Date(now),
      updatedAt: new Date(now),
    })
    .where(sql`trim(${leads.manychatSubId}) = ${row.sid.trim()}`);

  // Push the new follow_up_count + lastFollowUpAt to GHL so Eli sees it in
  // the contact card. Fire-and-forget — never throws.
  await syncLeadToGHL(row.sid);

  await logDecision({
    ...logBase,
    decidedBy,
    action: "reply_sent",
    replyText: textToSend,
    metadata: { ...replayMeta, rawJson: verdict.rawJson },
  });

  // HARD LIMIT — if this was the final attempt, escalate now. Skipped for
  // unbounded rules (re-engagement loop).
  if (!rule.unbounded && attempt >= maxFollowups) {
    await escalateLead({
      sid: row.sid,
      name: row.name,
      phone: row.phone,
      stage: row.pipelineStage,
      reason: "no_reply",
    });
    return { sid: row.sid, action: "escalated", detail: "after final send" };
  }

  return {
    sid: row.sid,
    action: "sent",
    detail: `${rule.template}#${attempt}${decidedBy === "llm_override" ? " (override)" : ""}`,
  };
}

async function processFactoryLead(row: {
  sid: string;
  name: string | null;
  phone: string | null;
  lastFollowUpAt: Date | null;
  botPaused: boolean;
  updatedAt: Date;
}): Promise<ProcessedLead> {
  if (row.botPaused) {
    return { sid: row.sid, action: "skipped_paused" };
  }
  const now = Date.now();
  if (row.lastFollowUpAt && now - row.lastFollowUpAt.getTime() < DAY_MS) {
    return { sid: row.sid, action: "skipped_cadence" };
  }
  const daysWaiting = Math.max(
    1,
    Math.floor((now - row.updatedAt.getTime()) / DAY_MS)
  );
  await sendEliDM(
    eliFactoryReminderTemplate({
      name: row.name,
      phone: row.phone,
      daysWaiting,
    })
  );
  // Use last_follow_up_at to throttle daily ping cadence (this is an Eli DM,
  // not a customer message, but the same column saves a schema addition).
  await db
    .update(leads)
    .set({ lastFollowUpAt: new Date(now) })
    .where(sql`trim(${leads.manychatSubId}) = ${row.sid.trim()}`);
  return { sid: row.sid, action: "sent", detail: "factory_reminder" };
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  // Vercel cron sends `Bearer $CRON_SECRET`; manual triggers use `BOT_SECRET`.
  const accepted = [process.env.BOT_SECRET, process.env.CRON_SECRET]
    .filter(Boolean)
    .map((s) => `Bearer ${s}`);
  if (accepted.length === 0 || !accepted.includes(auth ?? "")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Test-only escape hatch — bypasses quiet hours + no-send-day gates so
  // local cadence tests can run at any time. NEVER set in Vercel/prod.
  const bypassGates = process.env.FOLLOWUPS_BYPASS_GATES === "1";

  // Cadence + attempt cap are settings now. Read once per run so every lead in
  // this tick is judged by the same rules, and report them back in the
  // response — a cron whose behaviour is configurable should say what it was
  // configured with, or a bad edit is invisible until customers notice.
  const S = await getBotSettings();
  const rules = buildStageRules(S);
  const maxFollowups = Math.max(
    1,
    Math.min(8, S.followupMaxAttempts || MAX_FOLLOWUPS_FALLBACK)
  );

  // Gate 0: the master switch. Customer nudges stop; the factory reminder and
  // the FB-gap ping to Eli are internal and keep running.
  if (!S.followupsEnabled) {
    return NextResponse.json({ ok: true, skipped: "followups_disabled" });
  }

  // Gate 0.5: one run at a time.
  //
  // Two triggers point here now (a 15-minute GitHub Action plus the daily
  // Vercel cron as a safety net), and this route decides what to send by
  // reading `last_follow_up_at` and writing it back at the end. Two overlapping
  // runs would both read the pre-send value and both send — the customer gets
  // the identical nudge twice, which is exactly the "the bot repeats itself"
  // complaint that started this work.
  //
  // NOT a pg advisory lock: Neon's serverless driver sends each query as its
  // own HTTP request, so a session-scoped lock is dropped the moment the query
  // returns. Verified against production — `pg_try_advisory_lock` returned
  // true twice in a row for the same key, i.e. it would have protected
  // nothing. This claims a row instead, which survives between queries.
  //
  // The claim self-expires after 5 minutes (maxDuration is 60s), so a lambda
  // killed mid-run cannot wedge follow-ups shut.
  const claim = await db.execute(sql`
    INSERT INTO app_config (key, value, updated_at)
    VALUES ('followups.lock', jsonb_build_object('at', now()), now())
    ON CONFLICT (key) DO UPDATE
      SET value = jsonb_build_object('at', now()), updated_at = now()
      WHERE (app_config.value->>'at')::timestamptz < now() - interval '5 minutes'
    RETURNING key`);
  const gotLock = (((claim as any).rows ?? claim) as unknown[]).length > 0;
  if (!gotLock) {
    console.log("[followups] another run is in flight — skipping");
    return NextResponse.json({ ok: true, skipped: "already_running" });
  }

  try {
  // Gate 1: quiet hours.
  if (!bypassGates && isQuietNow()) {
    return NextResponse.json({ ok: true, skipped: "quiet_hours" });
  }
  // Gate 2: no-send day (Fri/Sat/holiday eve/holiday).
  if (!bypassGates && (await isNoSendDay())) {
    return NextResponse.json({ ok: true, skipped: "no_send_day" });
  }

  // Pull all leads that could potentially be in a follow-up state. Filter
  // in code rather than SQL — keeps the cadence/q_state logic in one place.
  const candidates = await db
    .select({
      sid: leads.manychatSubId,
      jid: leads.waJid,
      name: leads.name,
      phone: leads.phoneE164,
      pipelineStage: leads.pipelineStage,
      qState: leads.qState,
      followUpCount: leads.followUpCount,
      lastFollowUpAt: leads.lastFollowUpAt,
      botPaused: leads.botPaused,
      pipelineFlag: leads.pipelineFlag,
      updatedAt: leads.updatedAt,
      notes: leads.notes,
      botSummary: leads.botSummary,
    })
    .from(leads)
    .where(eq(leads.active, true));

  const customerResults: ProcessedLead[] = [];
  const factoryResults: ProcessedLead[] = [];

  for (const row of candidates) {
    const stage = (row.pipelineStage || "").toUpperCase();
    const subFlow = (row.qState as any)?.subFlow;
    // FACTORY_WAIT with subFlow=awaiting_factory_estimate = Eli is working
    // on the price manually. Daily reminder to Eli, no customer message.
    if (stage === "FACTORY_WAIT" && subFlow === "awaiting_factory_estimate") {
      const r = await processFactoryLead({
        sid: row.sid,
        name: row.name,
        phone: row.phone,
        lastFollowUpAt: row.lastFollowUpAt,
        botPaused: row.botPaused,
        updatedAt: row.updatedAt,
      });
      factoryResults.push(r);
      continue;
    }
    // Terminal stages — never follow up.
    if (stage === "WON" || stage === "LOST") {
      continue;
    }
    const r = await processCustomerLead({
      sid: row.sid,
      jid: row.jid,
      name: row.name,
      phone: row.phone,
      pipelineStage: row.pipelineStage,
      qState: row.qState,
      followUpCount: row.followUpCount,
      lastFollowUpAt: row.lastFollowUpAt,
      botPaused: row.botPaused,
      notes: row.notes,
      botSummary: row.botSummary,
    }, { rules, maxFollowups });
    customerResults.push(r);
  }

  const summarize = (rs: ProcessedLead[]) => {
    const by: Record<string, number> = {};
    for (const r of rs) by[r.action] = (by[r.action] ?? 0) + 1;
    return by;
  };

  try {
    const gaps = await loadSheetGaps();
    if (gaps.total > 0) {
      const lines: string[] = [
        `📋 פערי טופס FB: ${gaps.total}`,
        `  • ממתינים: ${gaps.pendingCount}`,
        `  • טלפון פגום: ${gaps.badPhoneCount}`,
        `  • שליחה נכשלה: ${gaps.sendFailedCount}`,
      ];
      if (gaps.otherErrorCount > 0) lines.push(`  • שגיאות אחרות: ${gaps.otherErrorCount}`);
      lines.push("https://albadi-crm.vercel.app/dashboard/v3/leads?stage=GAPS");
      await sendEliDM(lines.join("\n"));
    }
  } catch (e) {
    console.warn("[followups] sheet-gap alert failed", e);
  }

  return NextResponse.json({
    ok: true,
    // Echo the live configuration. A cron whose rhythm is editable has to
    // state what it ran with, or a bad edit stays invisible until customers
    // feel it. `warnings` carries anything a cadence box had to clamp.
    config: {
      maxFollowups,
      cadences: Object.fromEntries(
        STAGE_RULE_SHAPES.map((shape) => {
          const parsed = parseCadence(
            S[shape.settingKey] as string,
            shape.fallbackHours
          );
          return [
            shape.template,
            { hours: parsed.hours, warnings: parsed.warnings },
          ];
        })
      ),
    },
    customer: { total: customerResults.length, by: summarize(customerResults) },
    factory: { total: factoryResults.length, by: summarize(factoryResults) },
    details: { customer: customerResults, factory: factoryResults },
  });
  } finally {
    // Every early return above sits inside the try, so the claim is released
    // on the quiet-hours path and the error path too — not just the happy one.
    // Backdating rather than deleting keeps the row (and its updated_at) as a
    // record of when follow-ups last ran.
    await db
      .execute(
        sql`UPDATE app_config
            SET value = jsonb_build_object('at', now() - interval '1 hour')
            WHERE key = 'followups.lock'`
      )
      .catch((e) => console.warn("[followups] lock release failed", e));
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
