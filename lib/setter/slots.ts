/**
 * Setter layer — the hours the bot is allowed to offer for a call.
 *
 * Why this exists. The appointment skill carried an EXAMPLE — "היום ב-17:00 או
 * מחר ב-11:00" — and the generator copied it verbatim. Measured 30/08–01/09:
 * of 26 outbound messages that named an hour, 22 named exactly those two, and
 * six of them offered "היום ב-17:00" AFTER 17:00 had already passed (one at
 * 19:20). To the customer that reads as a machine that doesn't know what day
 * it is, which is exactly what it was.
 *
 * The fix is to stop asking a language model to invent a time. Code computes
 * the real windows — Israel working hours, never in the past, never on a
 * Sabbath or holiday — and hands the writer two exact strings. The validator
 * then refuses any hour that is not one of them, so the example in the skill
 * text (or in Eli's edited copy of it, which is a separate DB row) cannot leak
 * back in.
 *
 * The hour also VARIES per lead. Two customers messaged an hour apart should
 * not both be offered 11:00; a slot list that is identical across the pipeline
 * is how a personal message reads as a broadcast.
 */
import { isNoSendDay } from "../clock/hebcal";
import {
  addCalendarDays,
  jerusalemParts,
  jerusalemWallClock,
} from "../clock/callback-window";

/** Hours we are willing to offer. Working hours, on the hour, no 9:00 (Eli's
 *  morning is the factory) and nothing past 17:00 (a call offered for 18:00
 *  lands as the day ends). */
const HOUR_POOL = [10, 11, 12, 14, 15, 16, 17];

/** A call can't be proposed for five minutes from now — the customer has to
 *  read the message and Eli has to be free. */
const MIN_LEAD_MINUTES = 90;

const DAY_NAMES_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

export interface CallSlot {
  /** Exactly what the message should say: "מחר ב-12:00". */
  label: string;
  /** "12:00" — what the validator matches against. */
  time: string;
  iso: string;
}

/** Stable per-lead offset so different leads hear different hours. */
function hashOffset(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % HOUR_POOL.length;
}

function labelFor(slot: Date, now: Date): string {
  const p = jerusalemParts(slot);
  const n = jerusalemParts(now);
  const hhmm = `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
  const sameDay = p.year === n.year && p.month === n.month && p.day === n.day;
  if (sameDay) return `היום ב-${hhmm}`;
  const tomorrow = addCalendarDays(n.year, n.month, n.day, 1);
  if (p.year === tomorrow.year && p.month === tomorrow.month && p.day === tomorrow.day) {
    return `מחר ב-${hhmm}`;
  }
  // Weekday name from the Jerusalem calendar date, not the runtime's locale.
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return `ביום ${DAY_NAMES_HE[dow]} ב-${hhmm}`;
}

/**
 * Two concrete windows the bot may offer, soonest first.
 *
 * Walks forward day by day over real working days. Never returns a time in the
 * past, and returns an empty array rather than a bad slot — a message with no
 * hour beats a message offering yesterday.
 */
export async function proposeCallSlots(
  seed: string,
  now: Date = new Date(),
  count = 2,
): Promise<CallSlot[]> {
  const earliest = new Date(now.getTime() + MIN_LEAD_MINUTES * 60_000);
  const offset = hashOffset(seed);

  const out: CallSlot[] = [];
  let cursor = new Date(now.getTime());

  // ONE slot per day, over consecutive working days — "היום ב-16:00 או מחר
  // ב-11:00" is a real choice; two adjacent hours on the same afternoon is
  // barely one. The hour shifts per day as well as per lead, so a customer
  // who gets two messages doesn't get the same hour twice.
  for (let day = 0; day < 8 && out.length < count; day++) {
    const p = jerusalemParts(cursor);
    if (!(await isNoSendDay(cursor))) {
      const eligible = HOUR_POOL.map((h) => ({
        h,
        at: jerusalemWallClock(p.year, p.month, p.day, h, 0),
      })).filter((x) => x.at.getTime() >= earliest.getTime());
      if (eligible.length) {
        const pick = eligible[(offset + out.length) % eligible.length];
        out.push({
          label: labelFor(pick.at, now),
          time: `${String(pick.h).padStart(2, "0")}:00`,
          iso: pick.at.toISOString(),
        });
      }
    }
    const next = addCalendarDays(p.year, p.month, p.day, 1);
    cursor = jerusalemWallClock(next.year, next.month, next.day, 9, 0);
  }

  return out.sort((a, b) => a.iso.localeCompare(b.iso)).slice(0, count);
}

/** "עכשיו יום שלישי, 02/09, 14:30" — so the writer knows when it is. */
export function describeNow(now: Date = new Date()): string {
  const p = jerusalemParts(now);
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return `יום ${DAY_NAMES_HE[dow]}, ${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}, ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}
