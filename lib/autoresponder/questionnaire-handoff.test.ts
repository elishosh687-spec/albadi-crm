import { describe, expect, it } from "vitest";
import {
  COLORS_UNKNOWN_REPLY,
  DEFAULT_SHIPPING_OPTION_ID,
  getQuestionnaireFlow,
  renderAnswerLines,
  shouldRouteToFactory,
} from "./questionnaire";

describe("updated WhatsApp questionnaire handoff", () => {
  it("starts with quantity and contains no shipping question", () => {
    const flow = getQuestionnaireFlow();
    expect(flow[0]?.field).toBe("quantity");
    expect(flow.map((question) => question.field)).toEqual([
      "quantity",
      "product",
      "colors",
    ]);
    expect(flow.some((question) => question.field === "shipping")).toBe(false);
  });

  it("offers the logo-review path when colors are unknown", () => {
    const colors = getQuestionnaireFlow().find((question) => question.field === "colors");
    expect(colors?.options).toContainEqual({
      value: "unknown",
      label: "לא בטוחים — נשלח לוגו לבדיקה",
    });
    expect(COLORS_UNKNOWN_REPLY).toContain("שלחו כאן את קובץ הלוגו");
    expect(COLORS_UNKNOWN_REPLY).toContain("אנחנו ממשיכים מהלוגו הקיים שלכם");
  });

  it("defaults the confirmation copy to sea and routes express to a representative", () => {
    expect(DEFAULT_SHIPPING_OPTION_ID).toBe("s2");
    const normal = {
      step: 9,
      quantity: "q2",
      product: "p2",
      colors: "2",
      shipping: "s2",
      handles: "true",
      lamination: "false",
    };
    expect(renderAnswerLines(normal)).toContain(
      "🚚 משלוח: ימי (60–90 ימים מאישור הגרפיקה הסופית)"
    );
    expect(shouldRouteToFactory({ ...normal, expressRequested: true })).toBe(true);
    expect(shouldRouteToFactory({ ...normal, colorsUnknown: true })).toBe(true);
  });
});
