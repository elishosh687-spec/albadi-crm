import { describe, expect, it } from "vitest";
import { clampToWorkWindow } from "./callback-window";

describe("clampToWorkWindow configurable hours", () => {
  it("uses the configured start time for an early task", async () => {
    const now = new Date("2026-08-19T03:00:00.000Z");
    const due = await clampToWorkWindow(
      new Date("2026-08-19T04:00:00.000Z"),
      now,
      { start: "10:30", end: "16:00" },
    );
    expect(due.toISOString()).toBe("2026-08-19T07:30:00.000Z");
  });

  it("fails safely to the established window when custom hours are reversed", async () => {
    const now = new Date("2026-08-19T03:00:00.000Z");
    const due = await clampToWorkWindow(
      new Date("2026-08-19T04:00:00.000Z"),
      now,
      { start: "18:00", end: "09:00" },
    );
    expect(due.toISOString()).toBe("2026-08-19T06:00:00.000Z");
  });
});
