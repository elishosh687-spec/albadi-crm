/**
 * lib/sheets/lead-gaps.ts — the "פערי טופס" classifier. The module imports the
 * DB transitively; the unit-setup Proxy keeps that inert, and these three
 * helpers are pure.
 */
import { describe, expect, it } from "vitest";
import { classifyRow, parseCSVLine, resolveGapCols } from "./lead-gaps";

describe("classifyRow — precedence", () => {
  it("BAD_PHONE wins, even over SENT", () => {
    expect(classifyRow("BAD_PHONE: no digits", null)).toBe("bad_phone");
    expect(classifyRow("BAD_PHONE: x", "SENT")).toBe("bad_phone");
  });
  it("lead_created_send_failed → send_failed", () => {
    expect(classifyRow("lead_created_send_failed", "")).toBe("send_failed");
  });
  it("http_* / exception_* → other_error", () => {
    expect(classifyRow("http_500", null)).toBe("other_error");
    expect(classifyRow("exception_TypeError", null)).toBe("other_error");
  });
  it("SENT marker (any case, padded) → null = not a gap", () => {
    expect(classifyRow("sent", "SENT")).toBeNull();
    expect(classifyRow(null, " sent ")).toBeNull();
    expect(classifyRow("tagged_only", "Sent")).toBeNull();
  });
  it("anything else → pending", () => {
    expect(classifyRow(null, null)).toBe("pending");
    expect(classifyRow("", "")).toBe("pending");
    expect(classifyRow("sent", "")).toBe("pending"); // status text alone is not the marker
  });
});

describe("parseCSVLine", () => {
  it("splits plain fields and keeps empty trailing ones", () => {
    expect(parseCSVLine("a,b,,c,")).toEqual(["a", "b", "", "c", ""]);
  });
  it("keeps commas inside quotes and unescapes doubled quotes", () => {
    expect(parseCSVLine('"כהן, דני",p:+972,"he said ""hi"""')).toEqual(["כהן, דני", "p:+972", 'he said "hi"']);
  });
  it("an empty line is one empty field", () => {
    expect(parseCSVLine("")).toEqual([""]);
  });
});

describe("resolveGapCols", () => {
  const META = Array.from({ length: 12 }, (_, i) => `m${i}`);
  it("marker columns fall back to 18/19/20 when their headers are blank", () => {
    const header = [...META, "שם_מלא", "phone_number", "email", "x", "lead_status", "y", "", "", ""];
    const c = resolveGapCols(header);
    expect(c.name).toBe(12);
    expect(c.phone).toBe(13);
    expect(c.sent).toBe(18);
    expect(c.status).toBe(19);
    expect(c.sid).toBe(20);
  });
  it("named marker headers win over the fallback", () => {
    const header = [...META, "שם_מלא", "crm_sent", "crm_status", "crm_sid", "phone_number"];
    const c = resolveGapCols(header);
    expect(c.sent).toBe(13);
    expect(c.status).toBe(14);
    expect(c.sid).toBe(15);
    expect(c.phone).toBe(16);
  });
});
