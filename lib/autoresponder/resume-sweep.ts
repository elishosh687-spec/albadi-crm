/**
 * Hands the keys back to the bot.
 *
 * A pause set because a human stepped in was always meant to be temporary, but
 * nothing ever cleared it. Measured 2026-08-16: 81 of 117 leads with recent
 * inbound traffic were muted forever, leaving 5 leads in the whole system that
 * the sales brain could speak to. This sweep expires those pauses.
 *
 * Three things it refuses to touch, and the refusals are the point:
 *   • reasons that are promises to the customer (opt-out, "give me a human")
 *   • leads Eli marked "don't touch this one" (bot_pause_sticky)
 *   • rows paused before the reason column existed (`legacy`) — these are
 *     months of backlog, and silently un-muting all of them in one tick would
 *     be a surprise, not a feature. They are released only by an explicit
 *     opt-in call, so the first sweep after deploy can't blindside anyone.
 */
import { db } from "../db";
import { leads } from "../../drizzle/schema";
import { sql } from "drizzle-orm";
import { getBotSettings } from "../bot-settings/store";
import { AUTO_RESUMABLE_REASONS } from "./bot-pause";

export interface ResumeSweepResult {
  enabled: boolean;
  hours: number;
  /** Leads whose pause expired and are now listening again. */
  resumed: number;
  resumedSids: string[];
  /** Eligible by reason + age but exempted by the "don't touch" flag. */
  skippedSticky: number;
  /** Pre-column rows waiting for a deliberate release (see includeLegacy). */
  legacyWaiting: number;
  legacyResumed: number;
}

export async function runResumeSweep(opts?: {
  /** Preview only — report what would happen, change nothing. */
  dryRun?: boolean;
  /** Also release the pre-column backlog. Deliberate, one-off, Eli's call. */
  includeLegacy?: boolean;
}): Promise<ResumeSweepResult> {
  const S = await getBotSettings();
  const hours = S.autoResumeHours;
  const reasons = [...AUTO_RESUMABLE_REASONS];

  const cutoff = sql`now() - (${hours} || ' hours')::interval`;
  const expired = sql`
    ${leads.botPaused} = true
    AND ${leads.botPauseSticky} = false
    AND ${leads.botPauseReason} = ANY(${sql.raw(`ARRAY[${reasons.map((r) => `'${r}'`).join(",")}]::text[]`)})
    AND ${leads.botPausedAt} IS NOT NULL
    AND ${leads.botPausedAt} < ${cutoff}`;

  // Counted regardless of the enabled flag so the numbers stay honest in the
  // response even when the sweep is switched off.
  const [sticky] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(sql`
      ${leads.botPaused} = true
      AND ${leads.botPauseSticky} = true
      AND ${leads.botPausedAt} IS NOT NULL
      AND ${leads.botPausedAt} < ${cutoff}`);

  const [legacy] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(sql`${leads.botPaused} = true AND ${leads.botPauseReason} = 'legacy'
               AND ${leads.botPauseSticky} = false`);

  const base: ResumeSweepResult = {
    enabled: S.autoResumeEnabled,
    hours,
    resumed: 0,
    resumedSids: [],
    skippedSticky: sticky?.n ?? 0,
    legacyWaiting: legacy?.n ?? 0,
    legacyResumed: 0,
  };

  if (!S.autoResumeEnabled) {
    const [would] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(leads)
      .where(expired);
    console.log("[resume-sweep] disabled — would have resumed", would?.n ?? 0);
    return base;
  }

  if (opts?.dryRun) {
    const rows = await db
      .select({ sid: leads.manychatSubId })
      .from(leads)
      .where(expired)
      .limit(200);
    return { ...base, resumed: rows.length, resumedSids: rows.map((r) => r.sid) };
  }

  // followUpCount resets too: the lead is entering the cadence fresh, and
  // leaving a spent counter behind would mean the very first nudge after
  // waking up trips the 3-strike escalation and re-mutes the lead instantly.
  const resumed = await db
    .update(leads)
    .set({
      botPaused: false,
      botPausedAt: null,
      botPauseReason: null,
      followUpCount: 0,
      updatedAt: new Date(),
    })
    .where(expired)
    .returning({ sid: leads.manychatSubId });

  let legacyResumed = 0;
  if (opts?.includeLegacy) {
    const rows = await db
      .update(leads)
      .set({
        botPaused: false,
        botPausedAt: null,
        botPauseReason: null,
        followUpCount: 0,
        updatedAt: new Date(),
      })
      .where(sql`${leads.botPaused} = true AND ${leads.botPauseReason} = 'legacy'
                 AND ${leads.botPauseSticky} = false`)
      .returning({ sid: leads.manychatSubId });
    legacyResumed = rows.length;
  }

  if (resumed.length > 0 || legacyResumed > 0) {
    console.log(
      `[resume-sweep] resumed ${resumed.length} expired + ${legacyResumed} legacy (after ${hours}h)`
    );
  }

  return {
    ...base,
    resumed: resumed.length,
    resumedSids: resumed.map((r) => r.sid),
    legacyResumed,
    legacyWaiting: Math.max(0, (legacy?.n ?? 0) - legacyResumed),
  };
}
