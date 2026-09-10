/**
 * lib/sheets/fb-form-columns.ts — Meta Instant-Form sheet columns resolved by
 * HEADER NAME, with the historical positions only as a fallback. The 18/08/2026
 * sheet ("albadi 18.8.26") put phone/email/lead_status at 17/18/16 — a fixed
 * index would have posted an answer as the phone number.
 */
import { describe, expect, it } from "vitest";
import { cell, resolveFbFormColumns, rowAnswers } from "./fb-form-columns";

const META = [
  "id", "created_time", "ad_id", "ad_name", "adset_id", "adset_name",
  "campaign_id", "campaign_name", "form_id", "form_name", "is_organic", "platform",
];

/** The pre-18/08 layout: identity fields straight after the 12 meta columns. */
const OLD_HEADER = [...META, "שם_מלא", "phone_number", 'דוא"ל', "שם_החברה", "lead_status", "", "", ""];

/** The 18/08/2026 layout: two extra questions pushed the identity fields right. */
const NEW_HEADER = [
  ...META,
  "שם_מלא",            // 12
  "כמה שקיות אתם צריכים", // 13
  "מה המידה המבוקשת",     // 14
  "שם_החברה",          // 15
  "lead_status",       // 16
  "מספר_טלפון",        // 17
  'דוא"ל',             // 18
  "", "", "",          // Apps Script markers (blank headers)
];

describe("resolveFbFormColumns", () => {
  it("resolves the 18/08/2026 sheet by name — phone 17, email 18, status 16", () => {
    const c = resolveFbFormColumns(NEW_HEADER);
    expect(c.idx.phone).toBe(17);
    expect(c.idx.email).toBe(18);
    expect(c.idx.leadStatus).toBe(16);
    expect(c.idx.fullName).toBe(12);
    expect(c.resolvedByName).toBe(true);
  });

  it("resolves the old layout by name too (same positions as the fallback)", () => {
    const c = resolveFbFormColumns(OLD_HEADER);
    expect(c.idx.phone).toBe(13);
    expect(c.idx.email).toBe(14);
    expect(c.idx.leadStatus).toBe(16);
    expect(c.resolvedByName).toBe(true);
  });

  it("falls back to the historical index only when the header is missing AND the sheet is wide enough", () => {
    const renamed = [...OLD_HEADER];
    renamed[13] = "cell"; // Meta renamed the phone column to something we don't know
    const c = resolveFbFormColumns(renamed);
    expect(c.idx.phone).toBe(13); // fallback position
    expect(c.resolvedByName).toBe(false);

    const short = META.slice(0, 5); // 5 columns — fallback 13 does not exist
    const s = resolveFbFormColumns(short);
    expect(s.idx.phone).toBe(-1);
    expect(s.idx.fullName).toBe(-1);
    expect(s.idx.adId).toBe(2); // found by name
  });

  it("header matching is case/space-insensitive", () => {
    const c = resolveFbFormColumns([...META, "Full Name", "Phone Number", "EMAIL"]);
    expect(c.idx.fullName).toBe(12);
    expect(c.idx.phone).toBe(13);
    expect(c.idx.email).toBe(14);
  });

  it("the form's own questions become `answers`; blank marker headers never do", () => {
    const c = resolveFbFormColumns(NEW_HEADER);
    const labels = c.answers.map((a) => a.label);
    expect(labels).toContain("כמה שקיות אתם צריכים");
    expect(labels).toContain("מה המידה המבוקשת");
    expect(labels).toContain("שם_החברה");
    expect(labels).toContain('דוא"ל'); // email is deliberately NOT in NOT_AN_ANSWER
    expect(labels).not.toContain("");
    expect(labels).not.toContain("phone_number");
    expect(labels).not.toContain("שם_מלא");
    expect(c.answers.every((a) => NEW_HEADER[a.index].trim().length > 0)).toBe(true);
  });
});

describe("cell / rowAnswers", () => {
  const cols = resolveFbFormColumns(NEW_HEADER);
  const row = [...Array(12).fill("meta"), "דני כהן", "5000", "30×40", "כהן בע\"מ", "complete", "p:+972501234567", "d@x.co"];

  it("cell reads by logical field and trims", () => {
    expect(cell(row, cols, "phone")).toBe("p:+972501234567");
    expect(cell(row, cols, "fullName")).toBe("דני כהן");
    expect(cell(row, cols, "nope")).toBe("");
  });

  it("rowAnswers keys by label and drops blanks", () => {
    const a = rowAnswers([...row.slice(0, 15), "", ...row.slice(16)], cols);
    expect(a["כמה שקיות אתם צריכים"]).toBe("5000");
    expect(a["מה המידה המבוקשת"]).toBe("30×40");
    expect(a).not.toHaveProperty("שם_החברה");
  });
});
