/**
 * Follow-up cron. Designed for Vercel cron at `every 15 minutes`.
 *
 * Per docs/CUSTOMER-FLOW.md v2 (source of truth):
 *   - Gates: quiet hours (21:00-09:00 Asia/Jerusalem), no-send days
 *     (Fri/Sat/holiday-eve/holiday via Hebcal).
 *   - Customer-side cadence by stage:
 *       NEW (mid-questionnaire abandoned)     → 1h, 1h, 1h
 *       AWAITING_DECISION (Stage 2)           → 24h, 36h, 72h
 *       AWAITING_LOGO (Stage 3)               → 24h, 36h, 72h
 *       AWAITING_FINAL (Stage 4)              → 24h, 36h, 72h
 *   - WAITING_FACTORY → Eli-only daily reminder (no customer message).
 *   - After 3 unanswered attempts → escalate (NEEDS_ELI + bot_paused + Eli DM).
 *   - Skips leads where bot_paused=true.
 *
 * Auth: Bearer BOT_SECRET. Vercel cron passes the header automatically if you
 * configure `crons` in vercel.json + a `CRON_SECRET` env (we re-use BOT_SECRET
 * here for consistency with /api/bot/cron).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { leads, messages } from "@/drizzle/schema";
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
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

export const runtime = "nodejs";
export const maxDuration = 60;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MAX_FOLLOWUPS = 3;

interface StageRule {
  match: (pipelineStage: string | null, qState: any) => boolean;
  /** Wait BEFORE attempt #N. cadences[0] = wait before 1st follow-up, etc. */
  cadences: number[];
  template: FollowupStage;
}

const STAGE_RULES: StageRule[] = [
  {
    // Stage 1 — NEW + questionnaire in-flight (started, not done, not bailed).
    match: (stage, q) => {
      const s = (stage || "").toUpperCase();
      if (s !== "" && s !== "NEW") return false;
      if (!q) return false;
      if (q.bailed || q.doneAt) return false;
      return typeof q.step === "number" && q.step >= 2 && q.step <= 7;
    },
    cadences: [1 * HOUR_MS, 1 * HOUR_MS, 1 * HOUR_MS],
    template: "MID_QUESTIONNAIRE",
  },
  {
    // Stage 2 — bot waiting on customer reply to estimated quote.
    match: (stage) => (stage || "").toUpperCase() === "AWAITING_DECISION",
    cadences: [24 * HOUR_MS, 36 * HOUR_MS, 72 * HOUR_MS],
    template: "AWAITING_DECISION",
  },
  {
    // Stage 3 — bot waiting on logo file.
    match: (stage) => (stage || "").toUpperCase() === "AWAITING_LOGO",
    cadences: [24 * HOUR_MS, 36 * HOUR_MS, 72 * HOUR_MS],
    template: "AWAITING_LOGO",
  },
  {
    // Stage 4 — bot waiting on customer reply to final price.
    match: (stage) => (stage || "").toUpperCase() === "AWAITING_FINAL",
    cadences: [24 * HOUR_MS, 36 * HOUR_MS, 72 * HOUR_MS],
    template: "AWAITING_FINAL",
  },
];

function pickRule(pipelineStage: string | null, qState: any): StageRule | null {
  for (const r of STAGE_RULES) {
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
      botPaused: true,
      updatedAt: new Date(),
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
}): Promise<ProcessedLead> {
  if (row.botPaused) {
    return { sid: row.sid, action: "skipped_paused" };
  }

  const rule = pickRule(row.pipelineStage, row.qState);
  if (!rule) {
    return { sid: row.sid, action: "no_rule" };
  }

  if (row.followUpCount >= MAX_FOLLOWUPS) {
    // Threshold already crossed somehow without escalation — escalate now.
    await escalateLead({
      sid: row.sid,
      name: row.name,
      phone: row.phone,
      stage: row.pipelineStage,
      reason: "no_reply",
    });
    return { sid: row.sid, action: "escalated", detail: "count>=max" };
  }

  const now = Date.now();
  // cadences[N] = wait before attempt #(N+1). followUpCount=0 → first send uses cadences[0].
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
  const text = followupTemplate(rule.template, attempt);

  try {
    await sendBridgeMessage(recipient, text);
  } catch (e) {
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

  if (attempt >= MAX_FOLLOWUPS) {
    await escalateLead({
      sid: row.sid,
      name: row.name,
      phone: row.phone,
      stage: row.pipelineStage,
      reason: "no_reply",
    });
    return { sid: row.sid, action: "escalated", detail: "after final send" };
  }

  return { sid: row.sid, action: "sent", detail: `${rule.template}#${attempt}` };
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
    })
    .from(leads)
    .where(eq(leads.active, true));

  const customerResults: ProcessedLead[] = [];
  const factoryResults: ProcessedLead[] = [];

  for (const row of candidates) {
    const stage = (row.pipelineStage || "").toUpperCase();
    if (stage === "WAITING_FACTORY") {
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
    if (stage === "WON" || stage === "DROPPED" || stage === "IN_PROGRESS") {
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
    });
    customerResults.push(r);
  }

  const summarize = (rs: ProcessedLead[]) => {
    const by: Record<string, number> = {};
    for (const r of rs) by[r.action] = (by[r.action] ?? 0) + 1;
    return by;
  };

  return NextResponse.json({
    ok: true,
    customer: { total: customerResults.length, by: summarize(customerResults) },
    factory: { total: factoryResults.length, by: summarize(factoryResults) },
    details: { customer: customerResults, factory: factoryResults },
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
