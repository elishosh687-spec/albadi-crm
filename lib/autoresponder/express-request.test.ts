import { describe, expect, it } from "vitest";
import { isExpressRequest } from "./express-request";

describe("isExpressRequest", () => {
  it.each([
    "צריך משלוח אקספרס",
    "אפשר אווירי?",
    "משלוח אוירי",
    "Express please",
    "אני צריך את זה מהר",
    "זה דחוף",
    "אפשר בהקדם?",
  ])("recognizes a fast-shipping request: %s", (text) => {
    expect(isExpressRequest(text)).toBe(true);
  });

  it.each([
    "לא צריך מהר",
    "אין לחץ",
    "משלוח רגיל",
    "כמה זה עולה?",
    "",
  ])("does not turn a normal reply into an express request: %s", (text) => {
    expect(isExpressRequest(text)).toBe(false);
  });
});
