import { describe, expect, it } from "vitest";
import { lifecycleOf } from "./insights";

describe("shared CRM lifecycle semantics", () => {
  it.each([
    [null, "NEW_INQUIRY"],
    ["INTAKE", "QUALIFIED"],
    ["DISCAVERY", "SALES_ACCEPTED"],
    ["FACTORY_WAIT", "SALES_ACCEPTED"],
    ["CONSIDERATION", "OPPORTUNITY"],
    ["WON", "CUSTOMER"],
    ["LOST", "CLOSED_LOST"],
  ] as const)("maps %s to %s", (stage, expected) => {
    expect(lifecycleOf(stage)).toBe(expected);
  });
});
