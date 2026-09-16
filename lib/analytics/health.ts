import { appConfig } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "@/lib/observability/log";

const log = logger("analysis");
const STATE_KEY = "analytics.funnel_health";
const ALERT_REPEAT_MS = 24 * 60 * 60 * 1000;

export interface FunnelHealthGaps {
  questionnaireStarts: number;
  questionnaireAnswers: number;
  quotes: number;
  quoteReplies: number;
}

export interface FunnelHealthState {
  status: "healthy" | "unhealthy" | "error";
  checkedAt: string;
  lastHealthyAt?: string;
  alertedAt?: string;
  gaps: FunnelHealthGaps;
  error?: string;
}

export interface FunnelHealthAssessment {
  healthy: boolean;
  totalGaps: number;
  lines: string[];
}

export function assessFunnelHealth(gaps: FunnelHealthGaps): FunnelHealthAssessment {
  const lines: string[] = [];
  if (gaps.questionnaireStarts > 0) lines.push(`${gaps.questionnaireStarts} שאלונים ללא אירוע פתיחה`);
  if (gaps.questionnaireAnswers > 0) lines.push(`${gaps.questionnaireAnswers} תשובות ללא אירוע שלב`);
  if (gaps.quotes > 0) lines.push(`${gaps.quotes} הצעות מחיר ללא אירוע שליחה`);
  if (gaps.quoteReplies > 0) lines.push(`${gaps.quoteReplies} תגובות למחיר ללא אירוע תגובה`);
  const totalGaps = Object.values(gaps).reduce((sum, value) => sum + value, 0);
  return { healthy: totalGaps === 0, totalGaps, lines };
}

function emptyGaps(): FunnelHealthGaps {
  return { questionnaireStarts: 0, questionnaireAnswers: 0, quotes: 0, quoteReplies: 0 };
}

export async function collectFunnelHealthGaps(options?: {
  leadSid?: string;
}): Promise<FunnelHealthGaps> {
  const leadSid = options?.leadSid?.trim() || null;
  const result = await db.execute(sql`
    WITH recent_attempts AS (
      SELECT trim(manychat_sub_id) sid, q_state, q_state->>'attemptId' attempt_id
      FROM leads
      WHERE q_state->>'attemptId' IS NOT NULL
        AND updated_at >= now() - interval '24 hours'
        AND updated_at < now() - interval '10 minutes'
        AND (${leadSid}::text IS NULL OR trim(manychat_sub_id) = ${leadSid})
    ), attempt_gaps AS (
      SELECT
        count(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM bot_funnel_events e
          WHERE e.attempt_id = a.attempt_id AND e.event = 'questionnaire_started'
        ) AND (
          a.q_state->>'quantity' IS NOT NULL OR
          a.q_state->>'product' IS NOT NULL OR
          a.q_state->>'colors' IS NOT NULL
        ))::int questionnaire_starts,
        (
          count(*) FILTER (WHERE a.q_state->>'quantity' IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM bot_funnel_events e WHERE e.attempt_id = a.attempt_id AND e.event = 'quantity_answered'
          )) +
          count(*) FILTER (WHERE a.q_state->>'product' IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM bot_funnel_events e WHERE e.attempt_id = a.attempt_id AND e.event IN ('size_answered','size_selected')
          )) +
          count(*) FILTER (WHERE a.q_state->>'colors' IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM bot_funnel_events e WHERE e.attempt_id = a.attempt_id AND e.event = 'colors_answered'
          ))
        )::int questionnaire_answers
      FROM recent_attempts a
    ), recent_quotes AS (
      SELECT DISTINCT ON (trim(q.lead_sid)) q.id, trim(q.lead_sid) sid, q.sent_at
      FROM bot_quotes q
      WHERE q.source = 'initial'
        AND q.sent_at >= now() - interval '24 hours'
        AND q.sent_at < now() - interval '10 minutes'
        AND (${leadSid}::text IS NULL OR trim(q.lead_sid) = ${leadSid})
      ORDER BY trim(q.lead_sid), q.sent_at
    ), quote_gaps AS (
      SELECT
        count(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM bot_funnel_events e
          WHERE e.event = 'quote_sent' AND e.quote_id = q.id::text
        ))::int quotes,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM messages m
          WHERE trim(m.manychat_sub_id) = q.sid
            AND (m.sender = 'lead' OR m.direction = 'in')
            AND m.received_at > q.sent_at
            AND m.received_at < now() - interval '10 minutes'
        ) AND NOT EXISTS (
          SELECT 1 FROM bot_funnel_events e
          WHERE e.event IN ('post_quote_reply','quote_replied') AND e.quote_id = q.id::text
        ))::int quote_replies
      FROM recent_quotes q
    )
    SELECT a.questionnaire_starts, a.questionnaire_answers, q.quotes, q.quote_replies
    FROM attempt_gaps a CROSS JOIN quote_gaps q
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return {
    questionnaireStarts: Number(row?.questionnaire_starts ?? 0),
    questionnaireAnswers: Number(row?.questionnaire_answers ?? 0),
    quotes: Number(row?.quotes ?? 0),
    quoteReplies: Number(row?.quote_replies ?? 0),
  };
}

export async function loadFunnelHealthState(): Promise<FunnelHealthState | null> {
  const [row] = await db
    .select({ value: appConfig.value })
    .from(appConfig)
    .where(eq(appConfig.key, STATE_KEY))
    .limit(1);
  return (row?.value as FunnelHealthState | undefined) ?? null;
}

async function saveState(state: FunnelHealthState): Promise<void> {
  await db
    .insert(appConfig)
    .values({ key: STATE_KEY, value: state })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value: state, updatedAt: new Date() },
    });
}

export async function runFunnelHealthCheck(options?: { dry?: boolean }): Promise<{
  ok: boolean;
  assessment: FunnelHealthAssessment;
  alerted: boolean;
  recovered: boolean;
}> {
  const dry = options?.dry ?? false;
  const previous = await loadFunnelHealthState();
  const now = new Date();
  try {
    const gaps = await collectFunnelHealthGaps();
    const assessment = assessFunnelHealth(gaps);
    let alerted = false;
    let recovered = false;
    let alertedAt = previous?.alertedAt;

    if (!assessment.healthy) {
      const alertIsStale = !alertedAt || now.getTime() - new Date(alertedAt).getTime() >= ALERT_REPEAT_MS;
      if (alertIsStale && !dry) {
        const { sendEliDM } = await import("@/lib/notify/eli");
        const dm = await sendEliDM(
          `🚨 *נתוני המשפך לא מתעדכנים כמו שצריך*\n${assessment.lines.map((line) => `• ${line}`).join("\n")}\n\nהבדיקה משווה פעילות ב־24 השעות האחרונות וממתינה 10 דקות לפני התרעה.\nפרטים: Axiom → albadi_crm, feature=analysis`
        );
        alerted = dm === "sent" || dm === "dry_run";
        if (alerted) alertedAt = now.toISOString();
        log.warn("funnel_health.alerted", { gaps, dm });
      }
    } else if (previous?.alertedAt && !dry) {
      const { sendEliDM } = await import("@/lib/notify/eli");
      const dm = await sendEliDM("✅ *נתוני המשפך חזרו להתעדכן*\nהפערים נסגרו והבדיקה האחרונה עברה בהצלחה.");
      recovered = dm === "sent" || dm === "dry_run";
      if (recovered) alertedAt = undefined;
      log.info("funnel_health.recovered", { dm });
    }

    if (!dry) {
      await saveState({
        status: assessment.healthy ? "healthy" : "unhealthy",
        checkedAt: now.toISOString(),
        lastHealthyAt: assessment.healthy ? now.toISOString() : previous?.lastHealthyAt,
        ...(alertedAt ? { alertedAt } : {}),
        gaps,
      });
    }
    log.info("funnel_health.checked", { healthy: assessment.healthy, gaps, dry });
    return { ok: assessment.healthy, assessment, alerted, recovered };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error("funnel_health.check_failed", error);
    if (!dry) {
      const priorAlert = previous?.alertedAt ? new Date(previous.alertedAt).getTime() : 0;
      let alertedAt = previous?.alertedAt;
      let alerted = false;
      if (!priorAlert || now.getTime() - priorAlert >= ALERT_REPEAT_MS) {
        const { sendEliDM } = await import("@/lib/notify/eli");
        const dm = await sendEliDM(`🚨 *בדיקת בריאות המשפך נכשלה*\nלא ניתן היה לוודא שהנתונים מתעדכנים.\n\nפרטים: Axiom → albadi_crm, feature=analysis`);
        alerted = dm === "sent" || dm === "dry_run";
        if (alerted) alertedAt = now.toISOString();
      }
      await saveState({
        status: "error",
        checkedAt: now.toISOString(),
        lastHealthyAt: previous?.lastHealthyAt,
        ...(alertedAt ? { alertedAt } : {}),
        gaps: previous?.gaps ?? emptyGaps(),
        error: message.slice(0, 300),
      });
      return {
        ok: false,
        assessment: assessFunnelHealth(previous?.gaps ?? emptyGaps()),
        alerted,
        recovered: false,
      };
    }
    throw error;
  }
}
