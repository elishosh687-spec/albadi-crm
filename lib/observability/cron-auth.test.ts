import { describe, expect, it } from "vitest";
import { cronBearerOk } from "./cron-auth";

const env = { BOT_SECRET: "b", CALL_TRIGGER_SECRET: "c", CRON_SECRET: "r" };

describe("cronBearerOk", () => {
  it("any of the three internal secrets opens every job", () => {
    for (const s of ["b", "c", "r"]) expect(cronBearerOk(`Bearer ${s}`, env)).toBe(true);
  });
  it("anything else is refused, and an unset secret never matches an empty bearer", () => {
    expect(cronBearerOk("Bearer x", env)).toBe(false);
    expect(cronBearerOk(null, env)).toBe(false);
    expect(cronBearerOk("Bearer ", { BOT_SECRET: "" })).toBe(false);
    expect(cronBearerOk("b", env)).toBe(false);
  });
});
