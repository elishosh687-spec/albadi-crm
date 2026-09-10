import { describe, expect, it } from "vitest";
import {
  MAX_ATTEMPTS_CAP,
  MAX_GAP_HOURS,
  MIN_GAP_HOURS,
  describeCadence,
  formatCadence,
  parseCadence,
  toMs,
} from "./followup-cadence";

const FALLBACK = [2, 12, 23];

describe("parseCadence — normal input", () => {
  it("reads a comma list", () => {
    expect(parseCadence("2,12,23", FALLBACK)).toEqual({ hours: [2, 12, 23], warnings: [] });
  });

  it("tolerates spaces around the commas", () => {
    expect(parseCadence(" 2 , 12 ,23 ", FALLBACK).hours).toEqual([2, 12, 23]);
  });

  it("accepts spaces as the separator", () => {
    expect(parseCadence("2 12 23", FALLBACK).hours).toEqual([2, 12, 23]);
  });

  it("accepts the Arabic comma", () => {
    expect(parseCadence("2،12،23", FALLBACK).hours).toEqual([2, 12, 23]);
  });

  it("a single value", () => {
    expect(parseCadence("72", FALLBACK).hours).toEqual([72]);
  });

  it("keeps decimals", () => {
    expect(parseCadence("1.5,4", FALLBACK).hours).toEqual([1.5, 4]);
  });

  it("returns a COPY of the fallback, never the same array", () => {
    const r = parseCadence("", FALLBACK);
    expect(r.hours).toEqual(FALLBACK);
    expect(r.hours).not.toBe(FALLBACK);
  });
});

describe("parseCadence — inputs that must not become a spam loop", () => {
  it('"0,0,0" → fallback with a warning, not [0,0,0]', () => {
    const r = parseCadence("0,0,0", FALLBACK);
    expect(r.hours).toEqual(FALLBACK);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.warnings[r.warnings.length - 1]).toBe("לא נמצא אף ערך תקין — נעשה שימוש בברירת המחדל");
  });

  it(`"0.01,0.02" is clamped up to ${MIN_GAP_HOURS}h, and the clamp is reported`, () => {
    const r = parseCadence("0.01,0.02", FALLBACK);
    expect(r.hours).toEqual([MIN_GAP_HOURS, MIN_GAP_HOURS]);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0]).toBe(`0.01 שעות קצר מדי — הועלה ל-${MIN_GAP_HOURS}`);
  });

  // The "-5" → 5 bug: a naive digit-strip turned a negative into a valid
  // five-hour wait. The sign must be checked BEFORE stripping.
  it('"-5,-1" → fallback (a negative is rejected, not stripped to positive)', () => {
    const r = parseCadence("-5,-1", FALLBACK);
    expect(r.hours).toEqual(FALLBACK);
    expect(r.warnings[0]).toBe('"-5" אינו מספר שעות תקין — הושמט');
  });

  it("empty / null / undefined → fallback, silently", () => {
    for (const raw of ["", "   ", null, undefined]) {
      expect(parseCadence(raw, FALLBACK)).toEqual({ hours: FALLBACK, warnings: [] });
    }
  });

  it("garbage → fallback", () => {
    expect(parseCadence("abc,,,;;", FALLBACK).hours).toEqual(FALLBACK);
  });

  it('"2,abc,12" drops the bad entry and keeps the good ones', () => {
    const r = parseCadence("2,abc,12", FALLBACK);
    expect(r.hours).toEqual([2, 12]);
    expect(r.warnings).toEqual(['"abc" אינו מספר שעות תקין — הושמט']);
  });

  it(`twelve "1"s are cut to ${MAX_ATTEMPTS_CAP} with a warning`, () => {
    const r = parseCadence("1,1,1,1,1,1,1,1,1,1,1,1", FALLBACK);
    expect(r.hours).toHaveLength(MAX_ATTEMPTS_CAP);
    expect(r.warnings).toContain(`יותר מ-${MAX_ATTEMPTS_CAP} ניסיונות — נחתך`);
  });

  it(`"99999" is clamped to ${MAX_GAP_HOURS} with a warning`, () => {
    const r = parseCadence("99999", FALLBACK);
    expect(r.hours).toEqual([MAX_GAP_HOURS]);
    expect(r.warnings).toEqual([`99999 שעות ארוך מדי — הוגבל ל-${MAX_GAP_HOURS}`]);
  });

  it("every reachable input survives the ms conversion as a real wait", () => {
    for (const raw of ["0,0,0", "0.01", "abc", "", "2,12,23", "-3", "0.5"]) {
      const ms = toMs(parseCadence(raw, FALLBACK).hours);
      expect(ms.length).toBeGreaterThan(0);
      expect(Math.min(...ms)).toBeGreaterThanOrEqual(MIN_GAP_HOURS * 3_600_000);
    }
  });
});

describe("toMs / formatCadence / describeCadence", () => {
  it("toMs converts hours to whole milliseconds", () => {
    expect(toMs([2, 0.5, 1.5])).toEqual([7_200_000, 1_800_000, 5_400_000]);
  });

  it("formatCadence renders back into the settings box", () => {
    expect(formatCadence([2, 12, 23])).toBe("2,12,23");
    expect(formatCadence([1.5, 4])).toBe("1.5,4");
    expect(formatCadence([0.5])).toBe("0.5");
    expect(formatCadence([])).toBe("");
  });

  it("formatCadence → parseCadence round-trips", () => {
    for (const hours of [[2, 12, 23], [1.5, 4], [0.5, 72]]) {
      expect(parseCadence(formatCadence(hours), FALLBACK).hours).toEqual(hours);
    }
  });

  it("describeCadence speaks in cumulative hours, then days from 48h", () => {
    expect(describeCadence([])).toBe("אין תזכורות");
    expect(describeCadence([1])).toBe("תזכורת אחת — אחרי שעה");
    expect(describeCadence([4])).toBe("תזכורת אחת — אחרי 4 שעות");
    expect(describeCadence([2, 12, 23])).toBe("3 תזכורות — אחרי 2 שעות, 14 שעות, 37 שעות");
    expect(describeCadence([72])).toBe("תזכורת אחת — אחרי 3 ימים");
    expect(describeCadence([24, 36])).toBe("2 תזכורות — אחרי 24 שעות, 2.5 ימים");
  });
});
