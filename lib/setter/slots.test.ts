import { describe, expect, it, vi } from "vitest";

// hebcal.ts fetches hebcal.com for the holiday list. Replace it with the
// weekday-only rule so the tests are offline and deterministic; the Sabbath
// half of the rule is what the slot logic actually depends on.
vi.mock("@/lib/clock/hebcal", () => ({
  isNoSendDay: async (d: Date) => {
    const wd = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", weekday: "short" }).format(d);
    return wd === "Fri" || wd === "Sat";
  },
}));

import { describeNow, proposeCallSlots, type CallSlot } from "./slots";

const HOUR_POOL = [10, 11, 12, 14, 15, 16, 17];
const MIN_LEAD_MS = 90 * 60_000;

function jerusalem(d: Date | string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    hour12: false,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(d));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    weekday: get("weekday"),
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
  };
}

/** The invariants every slot list must satisfy, whatever the seed or clock. */
function expectWellFormed(slots: CallSlot[], now: Date) {
  for (const s of slots) {
    const at = jerusalem(s.iso);
    expect(new Date(s.iso).getTime()).toBeGreaterThanOrEqual(now.getTime() + MIN_LEAD_MS);
    expect(HOUR_POOL).toContain(at.hour);
    expect(at.minute).toBe(0);
    expect(["Fri", "Sat"]).not.toContain(at.weekday);
    expect(s.time).toBe(`${String(at.hour).padStart(2, "0")}:00`);
    expect(s.label.endsWith(`ב-${s.time}`)).toBe(true);
  }
  // at most one slot per calendar day, soonest first
  const days = slots.map((s) => jerusalem(s.iso).ymd);
  expect(new Set(days).size).toBe(days.length);
  expect([...slots].map((s) => s.iso)).toEqual([...slots].map((s) => s.iso).sort());
}

const SEED_A = "972502348255@c.us"; // hashOffset 5 → 16:00 on a full day
const SEED_B = "972545521186@c.us"; // hashOffset 4 → 15:00 on a full day

describe("proposeCallSlots", () => {
  // Incident 2026-09-01: at 19:20 IL the bot offered "היום ב-17:00" (six such
  // messages between 30/08 and 01/09, copied from an example in the skill).
  it("at 19:20 IL never offers 'היום', and never a slot in the past", async () => {
    const now = new Date("2026-09-01T16:20:00Z"); // Tuesday 19:20 Jerusalem
    for (const seed of [SEED_A, SEED_B]) {
      const slots = await proposeCallSlots(seed, now);
      expect(slots).toHaveLength(2);
      expectWellFormed(slots, now);
      expect(slots.some((s) => s.label.startsWith("היום"))).toBe(false);
      expect(slots.some((s) => jerusalem(s.iso).ymd === "2026-09-01")).toBe(false);
      expect(slots[0].label).toMatch(/^מחר ב-\d{2}:00$/);
      expect(slots[1].label).toMatch(/^ביום חמישי ב-\d{2}:00$/);
    }
  });

  it("at 12:01 IL the same-day slot is 'היום' and at least 90 minutes out", async () => {
    const now = new Date("2026-09-01T09:01:00Z"); // Tuesday 12:01 Jerusalem
    const slots = await proposeCallSlots(SEED_A, now);
    expectWellFormed(slots, now);
    expect(slots[0].label).toMatch(/^היום ב-1[4-7]:00$/);
    expect(slots[1].label).toMatch(/^מחר ב-\d{2}:00$/);
  });

  it("skips Friday and Saturday (now = Friday 10:00 IL)", async () => {
    const now = new Date("2026-09-04T07:00:00Z");
    const slots = await proposeCallSlots(SEED_A, now);
    expect(slots).toHaveLength(2);
    expectWellFormed(slots, now);
    expect(jerusalem(slots[0].iso).weekday).toBe("Sun");
    expect(jerusalem(slots[1].iso).weekday).toBe("Mon");
    expect(slots[0].label).toMatch(/^ביום ראשון ב-/);
    expect(slots[1].label).toMatch(/^ביום שני ב-/);
  });

  it("skips Saturday; Sunday is then 'מחר' (now = Saturday 12:00 IL)", async () => {
    const now = new Date("2026-09-05T09:00:00Z");
    const slots = await proposeCallSlots(SEED_B, now);
    expect(slots).toHaveLength(2);
    expectWellFormed(slots, now);
    expect(jerusalem(slots[0].iso).weekday).toBe("Sun");
    expect(slots[0].label).toMatch(/^מחר ב-/);
    expect(jerusalem(slots[1].iso).weekday).toBe("Mon");
  });

  it("two leads get different hours at the same moment", async () => {
    const now = new Date("2026-09-01T16:20:00Z");
    const a = await proposeCallSlots(SEED_A, now);
    const b = await proposeCallSlots(SEED_B, now);
    expect(a[0].time).not.toBe(b[0].time);
    expect(a[0].time).toBe("16:00");
    expect(b[0].time).toBe("15:00");
  });

  it("the hour shifts between the two days for one lead", async () => {
    const now = new Date("2026-09-01T16:20:00Z");
    const slots = await proposeCallSlots(SEED_A, now);
    expect(slots[0].time).not.toBe(slots[1].time);
  });

  it("is deterministic for a given seed and clock", async () => {
    const now = new Date("2026-09-01T16:20:00Z");
    expect(await proposeCallSlots(SEED_A, now)).toEqual(await proposeCallSlots(SEED_A, now));
  });

  it("honours count", async () => {
    const now = new Date("2026-08-31T05:00:00Z"); // Monday 08:00 Jerusalem
    const one = await proposeCallSlots(SEED_A, now, 1);
    const three = await proposeCallSlots(SEED_A, now, 3);
    expect(one).toHaveLength(1);
    expect(three).toHaveLength(3);
    expectWellFormed(three, now);
    // Mon / Tue / Wed — one per day
    expect(three.map((s) => jerusalem(s.iso).weekday)).toEqual(["Mon", "Tue", "Wed"]);
  });

  it("returns [] rather than a bad slot when nothing fits", async () => {
    expect(await proposeCallSlots(SEED_A, new Date("2026-09-01T16:20:00Z"), 0)).toEqual([]);
  });
});

describe("describeNow", () => {
  it("names the Hebrew weekday, date and Jerusalem wall-clock time", () => {
    expect(describeNow(new Date("2026-09-01T16:20:00Z"))).toBe("יום שלישי, 01/09, 19:20");
    expect(describeNow(new Date("2026-09-04T07:00:00Z"))).toBe("יום שישי, 04/09, 10:00");
    expect(describeNow(new Date("2026-09-05T09:00:00Z"))).toBe("יום שבת, 05/09, 12:00");
  });
});
