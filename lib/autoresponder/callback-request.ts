/**
 * Callback-time flow — "מתי נוח לכם לדבר?"
 *
 * When a customer goes quiet in a state where we want them on a call, the bot
 * sends ONE context-aware message asking when's a good time to talk. When the
 * customer replies with a time, we open a task for the salesperson (Itay) with
 * that time — so a silent lead turns into a scheduled call.
 *
 * Triggers (customer silent ≥ SILENCE_MIN minutes, once per lead):
 *   - quote_sent            — INTAKE, a quote is out, no reply
 *   - questionnaire_incomplete — pre-quote questionnaire abandoned mid-flight
 *   - new_lead_no_reply     — brand-new lead never answered the opening
 *   - call_no_answer        — a GHL call went unanswered, no reply since
 *
 * SAFETY: gated behind CALLBACK_REQUESTS_ENABLED=1. Off → detector sends
 * nothing (dry-run still works for review). The inbound reply→task path is
 * inert until a lead actually carries qState.callbackFlow="awaiting_reply",
 * which only happens once the flag has sent a request.
 */

import { db } from "@/lib/db";
import { leads, crmTasks } from "@/drizzle/schema";
import { sql, eq } from "drizzle-orm";
import { sendBridgeMessage } from "@/lib/bridge/client";
import { callLLM } from "./openai-client";
import { syncTaskToGHL } from "@/integrations/ghl/sync";
import { GHL_SALESPERSON_USER_ID } from "@/integrations/ghl/config";
import type { QState } from "./questionnaire";

export const CALLBACK_REQUESTS_ENABLED =
  (process.env.CALLBACK_REQUESTS_ENABLED ?? "").replace(/^﻿/, "") === "1";

/** Minutes of customer silence before the bot asks for a callback time. */
const SILENCE_MIN = 30;
/** Upper bound — only nudge leads that went quiet RECENTLY (not the whole
 *  months-old backlog). A lead silent longer than this is left to the normal
 *  re-engagement cadence, not this "just went quiet → let's schedule a call" flow. */
const SILENCE_MAX_MIN = 360; // 6h
/** Don't step on a fresh manual/bot reply — skip if ANY message (in or out)
 *  landed in the last few minutes. */
const RECENT_ACTIVITY_MIN = 15;
/** How far back a GHL no-answer call still counts as a fresh trigger. */
const CALL_LOOKBACK_MIN = 180;
/** Never message more than this many leads in one detector run. */
const MAX_PER_RUN = 40;
/** Skip internal/test leads (Eli's own notification number, seed/test rows). */
function isInternalLead(name: string | null): boolean {
  const n = (name ?? "").toLowerCase();
  return /אלבדי|albadi|test|config|בדיקה/.test(n);
}

export type CallbackReason =
  | "quote_sent"
  | "questionnaire_incomplete"
  | "new_lead_no_reply"
  | "call_no_answer";

export interface CallbackCandidate {
  sid: string;
  name: string | null;
  recipient: string;
  reason: CallbackReason;
  silentMinutes: number | null;
  lastInboundText: string | null;
}

const REASON_HE: Record<CallbackReason, string> = {
  quote_sent: "נשלחה הצעת מחיר והלקוח שתק",
  questionnaire_incomplete: "השאלון לא הושלם",
  new_lead_no_reply: "ליד חדש שלא הגיב לפתיח",
  call_no_answer: "שיחה יצאה ולא נענתה",
};

function parseQ(raw: unknown): QState | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as QState;
    } catch {
      return null;
    }
  }
  return raw as QState;
}

/**
 * Find leads that should be asked for a callback time now. Read-only.
 * A lead is skipped if it already carries a callbackFlow (asked/answered/declined).
 */
export async function findCallbackCandidates(): Promise<CallbackCandidate[]> {
  // Stage/state-based triggers (quote_sent / questionnaire_incomplete /
  // new_lead_no_reply). One query with last-inbound/last-any + minutes silent.
  const rows = (
    (await db.execute(sql`
      SELECT
        trim(l.manychat_sub_id) AS sid,
        l.name,
        l.wa_jid AS wa_jid,
        l.pipeline_stage AS stage,
        l.q_state AS q_state,
        l.quote_total AS quote_total,
        l.ghl_contact_id AS ghl_contact_id,
        l.created_at AS created_at,
        li.last_in,
        EXTRACT(EPOCH FROM (now() - COALESCE(li.last_in, l.created_at))) / 60 AS silent_min,
        la.since_any_min,
        li.last_in_text
      FROM leads l
      LEFT JOIN LATERAL (
        SELECT received_at AS last_in, text AS last_in_text
        FROM messages m
        WHERE trim(m.manychat_sub_id) = trim(l.manychat_sub_id) AND m.direction = 'in'
        ORDER BY received_at DESC LIMIT 1
      ) li ON true
      LEFT JOIN LATERAL (
        SELECT EXTRACT(EPOCH FROM (now() - max(received_at))) / 60 AS since_any_min
        FROM messages m WHERE trim(m.manychat_sub_id) = trim(l.manychat_sub_id)
      ) la ON true
      WHERE l.active = true
        AND COALESCE(l.bot_paused, false) = false
        AND (l.pipeline_stage IS NULL OR l.pipeline_stage = 'INTAKE')
    `)) as unknown as {
      rows?: Array<{
        sid: string;
        name: string | null;
        wa_jid: string | null;
        stage: string | null;
        q_state: unknown;
        quote_total: string | null;
        ghl_contact_id: string | null;
        created_at: string;
        last_in: string | null;
        silent_min: string | number | null;
        since_any_min: string | number | null;
        last_in_text: string | null;
      }>;
    }
  ).rows ?? [];

  const out: CallbackCandidate[] = [];
  const seen = new Set<string>();

  for (const r of rows) {
    if (isInternalLead(r.name)) continue;
    const q = parseQ(r.q_state);
    // Already in the callback flow — never re-ask.
    if (q?.callbackFlow) continue;
    const silent = r.silent_min == null ? null : Number(r.silent_min);
    // Only leads that went quiet RECENTLY (30 min .. 6h) — not the old backlog.
    if (silent == null || silent < SILENCE_MIN || silent > SILENCE_MAX_MIN) continue;
    // Don't step on a fresh manual/bot reply.
    const sinceAny = r.since_any_min == null ? null : Number(r.since_any_min);
    if (sinceAny != null && sinceAny < RECENT_ACTIVITY_MIN) continue;

    let reason: CallbackReason | null = null;
    if (r.stage === "INTAKE" && (r.quote_total || q?.doneAt)) {
      reason = "quote_sent";
    } else if (!r.stage) {
      // pre-quote questionnaire. New lead that never replied vs abandoned.
      reason = r.last_in ? "questionnaire_incomplete" : "new_lead_no_reply";
    }
    if (!reason) continue;

    const recipient = (r.wa_jid && r.wa_jid.trim()) || r.sid;
    if (!recipient || seen.has(r.sid)) continue;
    seen.add(r.sid);
    out.push({
      sid: r.sid,
      name: r.name,
      recipient,
      reason,
      silentMinutes: Math.round(silent),
      lastInboundText: r.last_in_text ?? null,
    });
  }

  // Call-no-answer trigger: a GHL call went unanswered recently and the lead
  // hasn't messaged since. Joined by ghl_contact_id.
  const callRows = (
    (await db.execute(sql`
      SELECT DISTINCT ON (trim(l.manychat_sub_id))
        trim(l.manychat_sub_id) AS sid, l.name, l.wa_jid AS wa_jid,
        c.call_started_at AS call_at,
        (SELECT max(received_at) FROM messages m
           WHERE trim(m.manychat_sub_id) = trim(l.manychat_sub_id) AND m.direction = 'in') AS last_in,
        l.q_state AS q_state
      FROM call_recording_imports c
      JOIN leads l ON l.ghl_contact_id = c.ghl_contact_id
      WHERE c.status = 'no_answer'
        AND c.call_started_at > now() - (${CALL_LOOKBACK_MIN} || ' minutes')::interval
        AND l.active = true
        AND COALESCE(l.bot_paused, false) = false
        AND (l.pipeline_stage IS NULL OR l.pipeline_stage NOT IN ('WON','LOST'))
      ORDER BY trim(l.manychat_sub_id), c.call_started_at DESC
    `)) as unknown as {
      rows?: Array<{
        sid: string;
        name: string | null;
        wa_jid: string | null;
        call_at: string;
        last_in: string | null;
        q_state: unknown;
      }>;
    }
  ).rows ?? [];

  for (const r of callRows) {
    if (seen.has(r.sid) || isInternalLead(r.name)) continue;
    const q = parseQ(r.q_state);
    if (q?.callbackFlow) continue;
    // Customer hasn't replied since the unanswered call.
    if (r.last_in && new Date(r.last_in).getTime() > new Date(r.call_at).getTime()) continue;
    const recipient = (r.wa_jid && r.wa_jid.trim()) || r.sid;
    if (!recipient) continue;
    seen.add(r.sid);
    out.push({
      sid: r.sid,
      name: r.name,
      recipient,
      reason: "call_no_answer",
      silentMinutes: null,
      lastInboundText: null,
    });
  }

  return out.slice(0, MAX_PER_RUN);
}

/** Context-aware "when's good to talk?" message (LLM, with a safe fallback). */
export async function composeCallbackMessage(c: CallbackCandidate): Promise<string> {
  const first = (c.name ?? "").trim().split(/\s+/)[0] || "";
  const fallback =
    `${first ? `היי ${first} 👋` : "היי 👋"}\n` +
    `נשמח לתאם שיחה קצרה כדי לסגור פרטים — באיזו שעה נוח לכם שנתקשר? ` +
    `(בוקר / צהריים / ערב, או שעה מדויקת) 🙏`;

  const llm = await callLLM<{ message?: string }>({
    jsonMode: true,
    temperature: 0.4,
    timeoutMs: 8000,
    system:
      "אתה נציג מכירות ישראלי חם וקצר של אלבדי (אריזות ממותגות). כתוב הודעת וואטסאפ אחת " +
      "בעברית שמבקשת מהלקוח באיזו שעה נוח לו שנתקשר לשיחה קצרה. טון אנושי, לא מכירתי-לחוץ, " +
      "משפט-שניים, אימוג'י אחד לכל היותר. אל תמציא פרטים/מחירים. החזר JSON: {\"message\": \"...\"}.",
    user:
      `שם: ${c.name ?? "לא ידוע"}\n` +
      `הקשר: ${REASON_HE[c.reason]}\n` +
      (c.lastInboundText ? `ההודעה האחרונה של הלקוח: "${c.lastInboundText}"\n` : "") +
      `כתוב הודעה אחת שמבקשת שעה נוחה לשיחה.`,
  });
  const msg = llm?.message?.trim();
  return msg && msg.length > 4 ? msg : fallback;
}

export interface RunReport {
  enabled: boolean;
  dry: boolean;
  count: number;
  items: Array<{ sid: string; name: string | null; reason: CallbackReason; message: string; sent: boolean }>;
}

/**
 * Detector pass: find candidates, compose, and (unless dry) send + mark state.
 * `dry` always composes but never sends — for review. Real send additionally
 * requires CALLBACK_REQUESTS_ENABLED=1.
 */
export async function runCallbackRequests(opts: { dry: boolean }): Promise<RunReport> {
  const candidates = await findCallbackCandidates();
  const items: RunReport["items"] = [];
  const willSend = opts.dry ? false : CALLBACK_REQUESTS_ENABLED;

  for (const c of candidates) {
    const message = await composeCallbackMessage(c);
    let sent = false;
    if (willSend) {
      try {
        await sendBridgeMessage(c.recipient, message);
        await markCallbackAsked(c.sid);
        sent = true;
      } catch (e) {
        console.error("[callback-request] send failed", c.sid, e);
      }
    }
    items.push({ sid: c.sid, name: c.name, reason: c.reason, message, sent });
  }

  return { enabled: CALLBACK_REQUESTS_ENABLED, dry: opts.dry, count: candidates.length, items };
}

/** Merge qState.callbackFlow="awaiting_reply" onto a lead (jsonb merge). */
async function markCallbackAsked(sid: string): Promise<void> {
  const patch = JSON.stringify({ callbackFlow: "awaiting_reply", callbackAskedAt: new Date().toISOString() });
  await db
    .update(leads)
    .set({ qState: sql`COALESCE(${leads.qState}, '{}'::jsonb) || ${patch}::jsonb`, updatedAt: new Date() })
    .where(eq(sql`trim(${leads.manychatSubId})`, sid.trim()));
}

async function setCallbackFlow(sid: string, patch: Partial<QState>): Promise<void> {
  await db
    .update(leads)
    .set({ qState: sql`COALESCE(${leads.qState}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`, updatedAt: new Date() })
    .where(eq(sql`trim(${leads.manychatSubId})`, sid.trim()));
}

export interface CallbackTimeResult {
  hasTime: boolean;
  declined: boolean;
  /** the availability text to show the salesperson, e.g. "מחר בבוקר" / "16:00". */
  timeText: string | null;
  /** best-effort concrete datetime (ISO) for the task due date, or null. */
  dueAtIso: string | null;
}

/** LLM: does this reply give a time to call (or decline)? */
export async function detectCallbackTime(text: string): Promise<CallbackTimeResult> {
  const empty: CallbackTimeResult = { hasTime: false, declined: false, timeText: null, dueAtIso: null };
  if (!text || !text.trim()) return empty;
  const nowIso = new Date().toISOString();
  const res = await callLLM<{
    has_time?: boolean;
    declined?: boolean;
    time_text?: string;
    due_at?: string | null;
  }>({
    jsonMode: true,
    timeoutMs: 8000,
    system:
      "אתה מסווג תשובת לקוח לשאלה 'מתי נוח לך שנתקשר?'. החזר JSON: " +
      "{\"has_time\": bool, \"declined\": bool, \"time_text\": string, \"due_at\": ISO8601|null}. " +
      "has_time=true אם הלקוח נתן זמן/חלון (למשל 'מחר בבוקר', 'אחרי 4', '16:00', 'עכשיו'). " +
      "declined=true אם סירב לשיחה. time_text = ניסוח קצר של הזמן בעברית. " +
      "due_at = הערכת תאריך-שעה מדויק ב-ISO אם אפשר, אחרת null. אל תמציא אם אין זמן ברור.",
    user: `עכשיו: ${nowIso}\nתשובת הלקוח: "${text.trim()}"`,
  });
  if (!res) return empty;
  return {
    hasTime: !!res.has_time,
    declined: !!res.declined,
    timeText: res.time_text?.trim() || null,
    dueAtIso: res.due_at ?? null,
  };
}

/**
 * Inbound hook: when a lead is awaiting a callback-time reply, interpret this
 * message. Returns true when it HANDLED the message (caller should stop — do
 * not run the normal questionnaire/decision handler for it).
 *
 * - time given → open a salesperson task + confirm to the customer + "answered"
 * - declined   → mark "declined", let normal flow continue (return false)
 * - unclear    → let normal flow continue (return false); the request already
 *   went out, so a real answer later still lands here.
 */
export async function handleCallbackReply(input: {
  sid: string;
  text: string;
  recipient: string;
  name: string | null;
  qState: QState | null;
}): Promise<boolean> {
  if (input.qState?.callbackFlow !== "awaiting_reply") return false;

  const verdict = await detectCallbackTime(input.text);

  if (verdict.declined) {
    await setCallbackFlow(input.sid, { callbackFlow: "declined" });
    return false; // let the normal handler still react to what they said
  }
  if (!verdict.hasTime) {
    return false; // not a time answer — fall through to normal handling
  }

  // Open a task for the salesperson with the requested time.
  const timeText = verdict.timeText ?? input.text.trim().slice(0, 60);
  const [task] = await db
    .insert(crmTasks)
    .values({
      manychatSubId: input.sid.trim(),
      title: `📞 לתאם שיחה — הלקוח ביקש: ${timeText}`,
      taskType: "callback_time",
      status: "open",
      dueAt: verdict.dueAtIso && Number.isFinite(new Date(verdict.dueAtIso).getTime())
        ? new Date(verdict.dueAtIso)
        : null,
      assignedTo: GHL_SALESPERSON_USER_ID || null,
    })
    .returning({ id: crmTasks.id });

  await setCallbackFlow(input.sid, { callbackFlow: "answered", requestedCallbackTime: timeText });

  // Confirm to the customer + push the task to GHL (best-effort).
  try {
    const first = (input.name ?? "").trim().split(/\s+/)[0];
    await sendBridgeMessage(
      input.recipient,
      `מעולה${first ? ` ${first}` : ""} 🙏 רשמנו — ${timeText}. ניצור קשר בזמן הזה.`
    );
  } catch (e) {
    console.error("[callback-request] confirm send failed", input.sid, e);
  }
  if (task?.id) {
    try {
      await syncTaskToGHL(task.id);
    } catch (e) {
      console.error("[callback-request] task GHL sync failed", task.id, e);
    }
  }
  return true;
}
