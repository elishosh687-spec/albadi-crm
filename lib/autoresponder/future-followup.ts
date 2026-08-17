/**
 * "להתקשר בעתיד" — the parked bucket, and the machinery that makes it a loop.
 *
 * `FUTURE_FOLLOW_UP` is where Eli drags a lead that went cold, usually after a
 * quote, meaning "work this later". Measured 2026-08-17 it held **45 active
 * leads** — the largest non-terminal bucket in the system, 25 of them holding a
 * quote we wrote — and **nothing touched them**. No follow-up rule matched the
 * stage, `pipeline-audit` listed it under HANDS_OFF_STAGES, `ghl-tasks/derive`
 * left it out of ACTIVE_STAGES, and `next-action` mapped it to a string no code
 * reads. Every cron tick they landed in the `no_rule` bucket and were dropped.
 *
 * This module supplies the three pieces the follow-up cron needs to run that
 * bucket safely. The goal there is not a reply — it is a booked phone call, so
 * the setter's `revive` / `book_call` goals do the talking and
 * `handleCallbackReply` turns the answer into a task.
 *
 * Entry stays MANUAL (Eli, 17.8): exhausting the INTAKE/CONSIDERATION follow-ups
 * still freezes a lead exactly as before. He decides which of those deserve the
 * long loop by dragging them here.
 */
import { db } from "@/lib/db";
import { leads, messages } from "@/drizzle/schema";
import { sql } from "drizzle-orm";
import type { BotSettings } from "@/lib/bot-settings/schema";

/** The stage string, as stored raw in `leads.pipeline_stage`. */
export const FUTURE_FOLLOW_UP_STAGE = "FUTURE_FOLLOW_UP";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Why a parked lead was passed over this tick.
 *
 * These exist so the dry run can distinguish "the rule said not yet" from
 * "nobody wrote a rule". Before this everything unhandled collapsed into
 * `no_rule` — 34 of 120 candidates on the last run — and that single bucket is
 * what hid this entire population for months.
 */
export type FutureSkipBucket =
  | "skipped_disabled"
  | "skipped_opted_out"
  | "skipped_internal"
  | "skipped_snoozed"
  | "skipped_too_fresh"
  | "skipped_too_cold";

export interface GateSkip {
  bucket: FutureSkipBucket;
  detail?: string;
}

/** Skip internal/test leads — Eli's own notification number, seed rows. */
export function isInternalLeadName(name: string | null | undefined): boolean {
  return /אלבדי|albadi|test|config|בדיקה/.test((name ?? "").toLowerCase());
}

/**
 * `leads.follow_up_date` is free TEXT fed by a GHL custom field, so it can hold
 * anything Eli types. An unparseable value must mean "no date" — never epoch
 * zero, which would read as "wake immediately, forever".
 */
export function parseWakeDate(raw: string | null | undefined): Date | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t) : null;
}

export interface FutureGateRow {
  sid: string;
  name: string | null;
  botPauseReason: string | null;
  followUpDate: string | null;
}

export interface FutureGateCtx {
  now: number;
  /** sid → last inbound message time. Absent = the customer never wrote. */
  lastInbound: Map<string, Date>;
  /**
   * A preview run. The master switch is ignored so a dry run can show what the
   * loop WOULD send — which is the only safe way to review it, since flipping
   * the real setting hands the 15-minute cron a live population. Every other
   * gate still applies, and nothing is sent or written.
   */
  dryRun?: boolean;
}

/**
 * May we speak to this parked lead right now?
 *
 * Deliberately separate from the rule's `match` predicate. `match` answers
 * "which loop is this lead in" — structure, and it stays in code. This answers
 * "is it admissible today" — policy, and it reads settings. Folding the two
 * together would make a gated lead fall through to `no_rule` and become
 * indistinguishable from a lead nobody wrote a rule for.
 *
 * Returns null when the lead may be nudged.
 */
export function gateFutureFollowup(
  row: FutureGateRow,
  S: BotSettings,
  ctx: FutureGateCtx
): GateSkip | null {
  // The master switch lives here rather than in `match` so a disabled feature
  // reports its own bucket instead of silently looking like an unhandled stage.
  if (!S.futureFollowupEnabled && !ctx.dryRun) return { bucket: "skipped_disabled" };

  // Belt and braces: `bot_paused` is already checked before rule matching, so
  // an opted-out lead can never reach this. Cold outreach to someone who asked
  // us to stop is the one mistake that must survive a refactor of that order.
  if (row.botPauseReason === "opt_out") return { bucket: "skipped_opted_out" };

  if (isInternalLeadName(row.name)) return { bucket: "skipped_internal" };

  // Eli types a date into the GHL custom field and the bot honours it — no new
  // UI needed. `handleCallbackReply` writes it too, so a lead with a call
  // already booked for Thursday doesn't get "shall we talk?" on Tuesday.
  const wake = parseWakeDate(row.followUpDate);
  if (wake && wake.getTime() > ctx.now) {
    return { bucket: "skipped_snoozed", detail: wake.toISOString().slice(0, 10) };
  }

  const last = ctx.lastInbound.get(row.sid.trim());
  const silentDays = last ? (ctx.now - last.getTime()) / DAY_MS : null;
  if (silentDays !== null) {
    // Protects the lead parked yesterday right after a live call where the
    // customer said "call me next month" — the highest-embarrassment case.
    if (silentDays < S.futureFollowupMinSilenceDays) {
      return { bucket: "skipped_too_fresh", detail: `${Math.floor(silentDays)}d` };
    }
    // Past some age an unsolicited nudge stops reading as a follow-up and
    // starts reading as spam. A knob, because where that line sits is Eli's call.
    if (silentDays > S.futureFollowupMaxAgeDays) {
      return { bucket: "skipped_too_cold", detail: `${Math.floor(silentDays)}d` };
    }
  }

  return null;
}

/**
 * Last inbound per lead, for the silence gate.
 *
 * NOT `leads.last_response_at` — that column has readers but **zero writers**
 * anywhere in the codebase, so it is permanently null and any gate built on it
 * would pass everything. Computed once per run, and only when the feature is on.
 */
export async function loadLastInboundMap(): Promise<Map<string, Date>> {
  const rows =
    ((await db.execute(sql`
      SELECT trim(manychat_sub_id) AS sid, max(received_at) AS at
      FROM messages
      WHERE sender = 'lead'
      GROUP BY 1
    `)) as unknown as { rows?: Array<{ sid: string; at: string | null }> }).rows ?? [];
  const out = new Map<string, Date>();
  for (const r of rows) {
    if (!r.at) continue;
    const d = new Date(r.at);
    if (Number.isFinite(d.getTime())) out.set(r.sid, d);
  }
  return out;
}

/**
 * Claim one of today's sends. Returns false when the budget is spent.
 *
 * A per-RUN cap would not help here: on the first enabled tick nearly every
 * parked lead is due at once (39 of 45 have a stale or null `last_follow_up_at`),
 * and a 15-minute cron with a cap of 3 drains the whole backlog in an afternoon.
 * A daily ceiling spreads it over working days, which is the difference between
 * reading every message that goes out and finding out afterwards.
 *
 * Atomic by construction: the CASE resets the counter on a new Jerusalem day,
 * and the WHERE refuses the claim once the cap is reached — so two overlapping
 * runs cannot both take the last slot. Same app_config row-claim technique as
 * the run lock, and for the same reason: Neon's HTTP driver silently drops
 * session-scoped advisory locks.
 */
export async function claimFutureDailySlot(cap: number): Promise<boolean> {
  const safeCap = Math.max(0, Math.floor(cap));
  if (safeCap <= 0) return false;
  const res = await db.execute(sql`
    INSERT INTO app_config (key, value, updated_at)
    VALUES ('followups.future_quota',
            jsonb_build_object(
              'day', to_char(now() AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD'),
              'sent', 1),
            now())
    ON CONFLICT (key) DO UPDATE SET
      value = CASE
        WHEN app_config.value->>'day' = to_char(now() AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD')
          THEN jsonb_set(app_config.value, '{sent}',
                         to_jsonb(COALESCE((app_config.value->>'sent')::int, 0) + 1))
        ELSE jsonb_build_object(
               'day', to_char(now() AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD'),
               'sent', 1)
      END,
      updated_at = now()
    WHERE app_config.value->>'day' <> to_char(now() AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD')
       OR COALESCE((app_config.value->>'sent')::int, 0) < ${safeCap}
    RETURNING key`);
  return (((res as any).rows ?? res) as unknown[]).length > 0;
}

/** Today's usage, for the bot map. Null before the first send of the day. */
export async function readFutureQuota(): Promise<{ day: string; sent: number } | null> {
  const rows =
    ((await db.execute(sql`
      SELECT value->>'day' AS day, COALESCE((value->>'sent')::int, 0) AS sent
      FROM app_config WHERE key = 'followups.future_quota'
    `)) as unknown as { rows?: Array<{ day: string | null; sent: number }> }).rows ?? [];
  const r = rows[0];
  if (!r?.day) return null;
  return { day: r.day, sent: Number(r.sent) || 0 };
}

/**
 * Entering "להתקשר בעתיד" restarts the clock.
 *
 * `follow_up_count` is the cadence engine's index into the rule's array, and
 * nothing reset it on a stage change. A lead arriving from an exhausted INTAKE
 * carries count=3 — with a cap of 4 it would send once and escalate, so the
 * bucket would appear to work and quietly do almost nothing. 22 of the 45 have
 * already been nudged, so this is the common case, not the edge.
 *
 * `priorStage` is required rather than read here, because both callers already
 * know it and the helper must not reset a lead that was ALREADY parked. A GHL
 * webhook retry, or any re-fire, would otherwise zero the counter mid-loop and
 * hand the lead a second full budget of nudges.
 *
 * Never throws: a stage change must not fail because the reset did.
 */
export async function enterFutureFollowUp(
  sid: string,
  via: "widget" | "ghl_drag" | "audit",
  priorStage: string | null | undefined
): Promise<void> {
  if ((priorStage ?? "").toUpperCase() === FUTURE_FOLLOW_UP_STAGE) return;
  const patch = JSON.stringify({
    parkedAt: new Date().toISOString(),
    parkedVia: via,
  });
  try {
    await db
      .update(leads)
      .set({
        followUpCount: 0,
        lastFollowUpAt: null,
        qState: sql`COALESCE(${leads.qState}, '{}'::jsonb) || ${patch}::jsonb`,
        updatedAt: new Date(),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${sid.trim()}`);
  } catch (e) {
    console.warn("[future-followup] clock reset failed", sid, e);
  }
}
