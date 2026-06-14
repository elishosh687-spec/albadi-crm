// Callback scheduling window. Given a desired callback time (e.g. parsed from
// "call me back in 2 hours"), snap it to the next valid sales work slot so the
// task never lands at night, on a weekend, or on a holiday — and never in the
// past.
//
// Work window: Sunday–Thursday, 09:00–18:00 Israel time.
//
// Distinct from lib/clock/quiet-hours.ts (`isQuietNow` = 21:00–09:00 send
// blackout) — this is the *daytime work* window, a different range. Reuses
// JERUSALEM_TZ and the holiday/weekend detection from hebcal.ts.

import { JERUSALEM_TZ } from "./quiet-hours";
import { isNoSendDay } from "./hebcal";

const WORK_START_HOUR = 9; // 09:00 inclusive
// 21:00 exclusive — aligned with the bot's quiet-hours boundary (contact is
// allowed until 21:00). A short-fuse callback like "call me in 30 min" made at
// ~18:20 must stay TODAY, not roll to tomorrow 09:00. Only genuinely late-night
// callbacks (>= 21:00) roll forward. (Was 18:00 — too early; see Alon Nimrodi
// 2026-06-14: 17:51 call + 30 min = 18:21 wrongly pushed to next-day 09:00.)
const WORK_END_HOUR = 21;
const MAX_ROLL_ITERATIONS = 14; // guard against pathological holiday stretches

interface JerusalemParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function jerusalemParts(d: Date): JerusalemParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: JERUSALEM_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0; // some runtimes render midnight as "24"
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour,
    minute: Number(get("minute")),
  };
}

// Offset (ms east of UTC) that Asia/Jerusalem has at the given instant.
// Handles the +02:00 (winter) / +03:00 (summer DST) switch automatically.
function jerusalemOffsetMs(utcMs: number): number {
  const p = jerusalemParts(new Date(utcMs));
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  // `utcMs` may carry seconds; round both to the minute for a clean offset.
  return asUtc - Math.floor(utcMs / 60000) * 60000;
}

// Build the UTC Date corresponding to a Jerusalem wall-clock time.
function jerusalemWallClock(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const off1 = jerusalemOffsetMs(guess);
  let ts = guess - off1;
  // Re-check once in case the guess straddled a DST boundary.
  const off2 = jerusalemOffsetMs(ts);
  if (off2 !== off1) ts = guess - off2;
  return new Date(ts);
}

// Roll a Jerusalem calendar date forward N days (pure Y-M-D arithmetic via UTC
// — no TZ involved, just month/year carry).
function addCalendarDays(
  year: number,
  month: number,
  day: number,
  n: number,
): { year: number; month: number; day: number } {
  const dt = new Date(Date.UTC(year, month - 1, day));
  dt.setUTCDate(dt.getUTCDate() + n);
  return {
    year: dt.getUTCFullYear(),
    month: dt.getUTCMonth() + 1,
    day: dt.getUTCDate(),
  };
}

/**
 * Snap `at` to the next valid sales work slot (Sun–Thu, 09:00–18:00 Israel),
 * never in the past. Preserves the requested time when it already falls inside
 * the window; otherwise advances to 09:00 of the next working day.
 *
 * @param at  Desired callback time.
 * @param now Reference "now" (injectable for testing); defaults to current time.
 */
export async function clampToWorkWindow(
  at: Date,
  now: Date = new Date(),
): Promise<Date> {
  // Never schedule in the past.
  let cur =
    at.getTime() < now.getTime() ? new Date(now.getTime()) : new Date(at.getTime());

  for (let i = 0; i < MAX_ROLL_ITERATIONS; i++) {
    const p = jerusalemParts(cur);

    // Weekend / holiday / holiday-eve → jump to 09:00 next day and re-check.
    if (await isNoSendDay(cur)) {
      const next = addCalendarDays(p.year, p.month, p.day, 1);
      cur = jerusalemWallClock(next.year, next.month, next.day, WORK_START_HOUR, 0);
      continue;
    }

    // Before the window → pull up to 09:00 the same (working) day.
    if (p.hour < WORK_START_HOUR) {
      const sameDay9 = jerusalemWallClock(
        p.year,
        p.month,
        p.day,
        WORK_START_HOUR,
        0,
      );
      // Respect the past-guard: don't move earlier than `now`.
      cur = sameDay9.getTime() < now.getTime() ? new Date(now.getTime()) : sameDay9;
      // 09:00 on a working day is in-window → next loop returns it.
      continue;
    }

    // At/after the window close → 09:00 next day and re-check.
    if (p.hour >= WORK_END_HOUR) {
      const next = addCalendarDays(p.year, p.month, p.day, 1);
      cur = jerusalemWallClock(next.year, next.month, next.day, WORK_START_HOUR, 0);
      continue;
    }

    // Inside the window on a working day.
    return cur;
  }

  // Fallback (only on a pathological holiday run beyond the cap).
  return cur;
}

/**
 * The next sales workday (today if it's a workday, else roll forward over
 * weekends/holidays) at a given Israel wall-clock time. Unlike
 * clampToWorkWindow this does NOT past-guard the time — so same-day tasks can
 * be staggered by time, and an already-passed slot simply shows as overdue
 * (which is the desired behaviour for a daily priority board).
 */
export async function jerusalemWorkdayAt(
  hour: number,
  minute: number,
  from: Date = new Date(),
): Promise<Date> {
  let cur = new Date(from.getTime());
  for (let i = 0; i < MAX_ROLL_ITERATIONS; i++) {
    const p = jerusalemParts(cur);
    if (await isNoSendDay(cur)) {
      const next = addCalendarDays(p.year, p.month, p.day, 1);
      cur = jerusalemWallClock(next.year, next.month, next.day, WORK_START_HOUR, 0);
      continue;
    }
    return jerusalemWallClock(p.year, p.month, p.day, hour, minute);
  }
  const p = jerusalemParts(cur);
  return jerusalemWallClock(p.year, p.month, p.day, hour, minute);
}
