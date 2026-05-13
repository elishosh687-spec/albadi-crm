// No-send-day detection. Skip Friday, Saturday, holiday eve, holiday day.
// Holiday list comes from Hebcal's public REST API; results cached in memory
// for the lifetime of the process (Vercel cron containers are short-lived,
// so a per-invocation fetch is acceptable). Israeli holidays only.

import { JERUSALEM_TZ } from "./quiet-hours";

interface HebcalItem {
  date: string;
  category: string;
  yomtov?: boolean;
  hebrew?: string;
}

interface HebcalResponse {
  items?: HebcalItem[];
}

const HEBCAL_URL =
  "https://www.hebcal.com/hebcal?v=1&cfg=json&maj=on&min=off&mod=off&nx=off&i=on&s=off&c=off&geo=none&lg=en";

interface CacheEntry {
  fetchedAt: number;
  holidayDates: Set<string>; // YYYY-MM-DD strings in Jerusalem TZ
}

const cache = new Map<number, CacheEntry>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

function jerusalemDateParts(d: Date): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: JERUSALEM_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: weekdayMap[get("weekday")] ?? 0,
  };
}

function ymd(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

async function loadYear(year: number): Promise<Set<string>> {
  const existing = cache.get(year);
  if (existing && Date.now() - existing.fetchedAt < CACHE_TTL_MS) {
    return existing.holidayDates;
  }
  try {
    const res = await fetch(`${HEBCAL_URL}&year=${year}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`hebcal ${res.status}`);
    const data = (await res.json()) as HebcalResponse;
    const dates = new Set<string>();
    for (const item of data.items ?? []) {
      // Only major holidays. Hebcal `category` is "holiday" with yomtov:true
      // for the no-melacha days (Rosh Hashanah, Yom Kippur, etc).
      if (item.yomtov === true) {
        dates.add(item.date.slice(0, 10));
      }
    }
    cache.set(year, { fetchedAt: Date.now(), holidayDates: dates });
    return dates;
  } catch (e) {
    // Soft-fail: better to send a follow-up on a holiday than to never send.
    // Log and return an empty set so callers fall back to weekday-only rules.
    console.warn("[hebcal] failed to load year", year, e);
    const empty = new Set<string>();
    cache.set(year, { fetchedAt: Date.now(), holidayDates: empty });
    return empty;
  }
}

function shiftDayJerusalem(d: Date, deltaDays: number): Date {
  return new Date(d.getTime() + deltaDays * 24 * 60 * 60 * 1000);
}

export async function isNoSendDay(at: Date = new Date()): Promise<boolean> {
  const today = jerusalemDateParts(at);
  // Friday (5) and Saturday (6) are full no-send.
  if (today.weekday === 5 || today.weekday === 6) return true;

  const todayKey = ymd(today.year, today.month, today.day);
  const tomorrow = jerusalemDateParts(shiftDayJerusalem(at, 1));
  const tomorrowKey = ymd(tomorrow.year, tomorrow.month, tomorrow.day);

  const yearsToCheck = new Set([today.year, tomorrow.year]);
  const holidays = new Set<string>();
  for (const y of yearsToCheck) {
    const ys = await loadYear(y);
    ys.forEach((d) => holidays.add(d));
  }

  // Today is a yom tov.
  if (holidays.has(todayKey)) return true;
  // Tomorrow is a yom tov → today is holiday-eve.
  if (holidays.has(tomorrowKey)) return true;

  return false;
}
