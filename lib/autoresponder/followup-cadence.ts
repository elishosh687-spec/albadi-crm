/**
 * Follow-up cadence — how long the bot waits before each nudge.
 *
 * This used to be four hardcoded arrays, and it was fiction in production: the
 * code is written for a 15-minute cron while Vercel only ran it once a day, so
 * the intended 2h → 12h → 23h rhythm could never happen. Measured over two
 * months, of 65 leads that got any follow-up at all, **56 got exactly one** and
 * a single lead ever reached three.
 *
 * Now it is a setting, written the way a person thinks about it: a
 * comma-separated list of hours, one entry per attempt. "2,12,23" means nudge
 * two hours after the quote, twelve hours after that, then twenty-three.
 *
 * THE FLOOR IS THE POINT. A cadence is the one setting where a typo becomes
 * harassment — "0" or a stray "0.1" would make the bot message a customer on
 * every cron tick, four times an hour, forever. Every value is clamped to
 * MIN_GAP_HOURS and the list is capped in length, so no input reachable from
 * the settings screen can produce a spam loop.
 */

/** Below this a "follow-up" is harassment, whatever the box says. */
export const MIN_GAP_HOURS = 0.5;
/** A year between nudges is a typo, not a strategy. */
export const MAX_GAP_HOURS = 24 * 60;
/** More attempts than this is nagging; the escalation exists for a reason. */
export const MAX_ATTEMPTS_CAP = 8;

export interface ParsedCadence {
  hours: number[];
  /** What was corrected, in Hebrew — surfaced so a clamp is never silent. */
  warnings: string[];
}

/**
 * Read "2, 12, 23" into [2, 12, 23].
 *
 * Anything unparseable falls back to `fallback` rather than to an empty list:
 * an empty cadence would mean "never follow up", which is a silent, total loss
 * of the feature — far worse than ignoring a bad edit.
 */
export function parseCadence(raw: string | null | undefined, fallback: number[]): ParsedCadence {
  const warnings: string[] = [];
  const text = (raw ?? "").trim();
  if (!text) return { hours: [...fallback], warnings };

  const parts = text
    .split(/[,،\s]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const hours: number[] = [];
  for (const p of parts) {
    // Check the sign BEFORE stripping: a naive strip turns "-5" into 5, so a
    // negative silently became a valid five-hour wait instead of being
    // rejected.
    const negative = /^\s*-/.test(p);
    const n = negative ? -1 : Number(p.replace(/[^\d.]/g, ""));
    if (!Number.isFinite(n) || n <= 0) {
      warnings.push(`"${p}" אינו מספר שעות תקין — הושמט`);
      continue;
    }
    if (n < MIN_GAP_HOURS) {
      warnings.push(`${n} שעות קצר מדי — הועלה ל-${MIN_GAP_HOURS}`);
      hours.push(MIN_GAP_HOURS);
      continue;
    }
    if (n > MAX_GAP_HOURS) {
      warnings.push(`${n} שעות ארוך מדי — הוגבל ל-${MAX_GAP_HOURS}`);
      hours.push(MAX_GAP_HOURS);
      continue;
    }
    hours.push(n);
  }

  if (hours.length === 0) {
    warnings.push("לא נמצא אף ערך תקין — נעשה שימוש בברירת המחדל");
    return { hours: [...fallback], warnings };
  }
  if (hours.length > MAX_ATTEMPTS_CAP) {
    warnings.push(`יותר מ-${MAX_ATTEMPTS_CAP} ניסיונות — נחתך`);
    hours.length = MAX_ATTEMPTS_CAP;
  }
  return { hours, warnings };
}

/** Hours → ms, for the cron's arithmetic. */
export function toMs(hours: number[]): number[] {
  return hours.map((h) => Math.round(h * 60 * 60 * 1000));
}

/** Render a cadence back into the settings box ("2,12,23"). */
export function formatCadence(hours: number[]): string {
  return hours.map((h) => (Number.isInteger(h) ? String(h) : h.toFixed(2).replace(/0+$/, ""))).join(",");
}

/** Plain-Hebrew summary of what a cadence actually does, for the settings UI. */
export function describeCadence(hours: number[]): string {
  if (hours.length === 0) return "אין תזכורות";
  let cumulative = 0;
  const points = hours.map((h) => {
    cumulative += h;
    if (cumulative >= 48) {
      const days = cumulative / 24;
      return `${days.toFixed(cumulative % 24 === 0 ? 0 : 1)} ימים`;
    }
    return cumulative === 1 ? "שעה" : `${cumulative} שעות`;
  });
  const count = hours.length === 1 ? "תזכורת אחת" : `${hours.length} תזכורות`;
  return `${count} — אחרי ${points.join(", ")}`;
}
