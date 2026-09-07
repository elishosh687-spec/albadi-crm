/**
 * Is WhatsApp actually reaching us right now?
 *
 * WHY THIS EXISTS (2026-09-07): inbound stopped at 06/09 22:31 and nobody
 * noticed for a full working day. Every customer who wrote got no reply, and
 * none of it reached the CRM. Nothing errored — the system just went deaf.
 *
 * The diagnostic that identified it is the one this module automates: ALL
 * Green API webhook types post to the SAME url, and on that day two of them
 * were still landing (`outgoingAPIMessageReceived` 13:36, `stateInstanceChanged`
 * 05:08) while the two DEVICE-sourced ones (`incomingMessageReceived`,
 * `outgoingMessageReceived`) had both died in the same second. So the url, the
 * deploy and the auth were all provably fine, and the fault was upstream at
 * the instance. That asymmetry is the signal.
 *
 * ⚠️ Read-only. Uses getStateInstance / getSettings only. NEVER
 * receiveNotification — it dequeues, and polling it here would delete the
 * messages this check exists to protect.
 */
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { greenConfigured, greenEndpoint } from "./client";
import { isNoSendDay } from "@/lib/clock/hebcal";

/** Inbound quiet for longer than this, while we are sending, is a fault. */
const SILENCE_ALERT_HOURS = 3;
/** Israel working window. Outside it, quiet is just quiet. */
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 21;

export interface GreenHealth {
  ok: boolean;
  /** Human-readable, Hebrew — this is what lands in the alert. */
  reason: string | null;
  checkedAt: string;
  configured: boolean;
  state: string | null;
  incomingWebhook: string | null;
  outgoingMessageWebhook: string | null;
  outgoingMessageStatusWebhook: string | null;
  inboundSilentHours: number | null;
  outboundInWindow: number;
  lastInboundAt: string | null;
  lastByType: Record<string, string>;
  /** True when the alert rule was suppressed by hours/Sabbath, not by health. */
  windowMuted: boolean;
  errors: string[];
}

async function greenGet(
  path: string,
  errors: string[],
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(greenEndpoint(path), {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      errors.push(`${path}: HTTP ${res.status}`);
      return null;
    }
    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    errors.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function jerusalemHour(at: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jerusalem",
      hour: "2-digit",
      hour12: false,
    }).format(at),
  );
}

export interface AssessOptions {
  now?: Date;
  /**
   * How long to wait on Green API. The cron can afford to be patient; a widget
   * screen cannot — a hung upstream must never stall a page Eli is looking at.
   */
  timeoutMs?: number;
}

export async function assessGreenHealth(
  opts: AssessOptions = {},
): Promise<GreenHealth> {
  const now = opts.now ?? new Date();
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const errors: string[] = [];
  const configured = greenConfigured();

  const [settings, stateResp] = configured
    ? await Promise.all([
        greenGet("getSettings", errors, timeoutMs),
        greenGet("getStateInstance", errors, timeoutMs),
      ])
    : [null, null];

  const state = str(stateResp?.stateInstance);
  const incomingWebhook = str(settings?.incomingWebhook);
  const outgoingMessageWebhook = str(settings?.outgoingMessageWebhook);
  const outgoingMessageStatusWebhook = str(
    settings?.outgoingMessageStatusWebhook,
  );

  // Traffic, straight from the DB — true regardless of what Green reports.
  const trafficRes = await db.execute(sql`
    SELECT
      max(received_at) FILTER (WHERE sender = 'lead') AS last_inbound,
      count(*) FILTER (
        WHERE sender IN ('bot','eli')
          AND received_at > ${now.toISOString()}::timestamptz
                            - make_interval(hours => ${SILENCE_ALERT_HOURS})
      )::int AS outbound_in_window
    FROM messages
  `);
  const traffic = (
    trafficRes as unknown as {
      rows: Array<{ last_inbound: string | null; outbound_in_window: number }>;
    }
  ).rows[0];

  const lastInboundAt = traffic?.last_inbound ?? null;
  const outboundInWindow = Number(traffic?.outbound_in_window ?? 0);
  const inboundSilentHours = lastInboundAt
    ? (now.getTime() - new Date(lastInboundAt).getTime()) / 3_600_000
    : null;

  // Last time we saw each webhook type — the asymmetry that named the fault.
  const typeRes = await db.execute(sql`
    SELECT type, max(occurred_at) AS newest
    FROM bridge_events
    WHERE type LIKE 'green.%' AND occurred_at > now() - interval '7 days'
    GROUP BY type
  `);
  const lastByType: Record<string, string> = {};
  for (const r of (typeRes as unknown as {
    rows: Array<{ type: string; newest: string }>;
  }).rows) {
    lastByType[r.type.replace(/^green\./, "")] = new Date(r.newest).toISOString();
  }

  const hour = jerusalemHour(now);
  const inWorkWindow = hour >= WORK_START_HOUR && hour < WORK_END_HOUR;
  const quietDay = await isNoSendDay(now);
  const windowMuted = !inWorkWindow || quietDay;

  // --- the rule -----------------------------------------------------------
  // Config faults are unconditional: a disabled webhook or an unauthorized
  // instance is broken at 3am on a Saturday too, and it is the exact thing a
  // human has to go and fix.
  let reason: string | null = null;

  if (!configured) {
    reason = "GreenAPI לא מוגדר — חסרים משתני סביבה";
  } else if (state && state !== "authorized") {
    reason = `האינסטנס במצב "${state}" — צריך סריקת QR מחדש בקונסולה`;
  } else if (incomingWebhook && incomingWebhook !== "yes") {
    reason = `incomingWebhook כבוי (${incomingWebhook}) — הודעות נכנסות לא נשלחות אלינו בכלל`;
  } else if (outgoingMessageWebhook && outgoingMessageWebhook !== "yes") {
    reason = `outgoingMessageWebhook כבוי (${outgoingMessageWebhook}) — הודעות שאתה מקליד בטלפון לא נקלטות`;
  } else if (
    // The signature of 07/09: we are sending, and nothing is coming back.
    // Requiring outbound activity is what stops a genuinely quiet afternoon
    // from paging anyone — "we speak but never hear" cannot happen when the
    // pipe is healthy.
    !windowMuted &&
    inboundSilentHours !== null &&
    inboundSilentHours > SILENCE_ALERT_HOURS &&
    outboundInWindow > 0
  ) {
    reason =
      `אין הודעה נכנסת כבר ${inboundSilentHours.toFixed(1)} שעות, ` +
      `למרות ש-${outboundInWindow} הודעות יצאו באותו זמן — הקליטה כנראה מתה`;
  }

  return {
    ok: reason === null,
    reason,
    checkedAt: now.toISOString(),
    configured,
    state,
    incomingWebhook,
    outgoingMessageWebhook,
    outgoingMessageStatusWebhook,
    inboundSilentHours:
      inboundSilentHours === null ? null : Number(inboundSilentHours.toFixed(2)),
    outboundInWindow,
    lastInboundAt: lastInboundAt ? new Date(lastInboundAt).toISOString() : null,
    lastByType,
    windowMuted,
    errors,
  };
}

/** One-line Hebrew summary for a WhatsApp DM or a workflow log. */
export function formatGreenHealth(h: GreenHealth): string {
  if (h.ok) {
    const silent =
      h.inboundSilentHours === null ? "—" : `${h.inboundSilentHours.toFixed(1)}ש׳`;
    return `✅ קליטת וואטסאפ תקינה · אחרונה לפני ${silent}`;
  }
  const lines = [
    "🚨 *תקלה בקליטת וואטסאפ*",
    "",
    h.reason ?? "לא ידוע",
    "",
    `מצב האינסטנס: ${h.state ?? "לא ידוע"}`,
    `incomingWebhook: ${h.incomingWebhook ?? "לא ידוע"}`,
    `הודעה נכנסת אחרונה: ${h.lastInboundAt ?? "אין"}`,
  ];
  if (h.errors.length) lines.push("", `שגיאות: ${h.errors.join("; ")}`);
  lines.push("", "לבדוק בקונסולת GreenAPI: getSettings + getStateInstance.");
  return lines.join("\n");
}
