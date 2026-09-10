import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AUTO_RESUMABLE_REASONS,
  GHL_IRREVOCABLE_REASONS,
  PAUSE_REASON_LABELS,
  ghlPauseChange,
  isAutoResumable,
  pauseFields,
  resumeFields,
  type BotPauseReason,
} from "./bot-pause";

const ALL_REASONS: BotPauseReason[] = [
  "human_reply",
  "escalation",
  "logo_received",
  "reengagement_reply",
  "opt_out",
  "human_handoff",
  "deal_won",
  "no_reply",
  "manual_toggle",
  "legacy",
];

const NOW = new Date("2026-08-18T09:30:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("pauseFields / resumeFields", () => {
  it("a pause always lands with its reason and timestamp", () => {
    expect(pauseFields("escalation")).toEqual({
      botPaused: true,
      botPausedAt: NOW,
      botPauseReason: "escalation",
      updatedAt: NOW,
    });
  });

  it("a resume clears the bookkeeping, not just the flag", () => {
    expect(resumeFields()).toEqual({
      botPaused: false,
      botPausedAt: null,
      botPauseReason: null,
      updatedAt: NOW,
    });
  });
});

describe("isAutoResumable", () => {
  it("only the four 'a human is driving this one' reasons expire", () => {
    const expiring = ALL_REASONS.filter(isAutoResumable);
    expect(expiring.sort()).toEqual(["escalation", "human_reply", "logo_received", "reengagement_reply"]);
    expect([...AUTO_RESUMABLE_REASONS].sort()).toEqual(expiring.sort());
  });

  it("promises to the customer never expire", () => {
    expect(isAutoResumable("opt_out")).toBe(false);
    expect(isAutoResumable("human_handoff")).toBe(false);
  });

  it("deliberate pauses never expire", () => {
    for (const r of ["deal_won", "no_reply", "manual_toggle", "legacy"]) {
      expect(isAutoResumable(r)).toBe(false);
    }
  });

  it("no reason / unknown reason → not resumable", () => {
    expect(isAutoResumable(null)).toBe(false);
    expect(isAutoResumable(undefined)).toBe(false);
    expect(isAutoResumable("")).toBe(false);
    expect(isAutoResumable("something_else")).toBe(false);
  });
});

describe("ghlPauseChange — a GHL resync may not lift a customer's opt-out", () => {
  // Incident 2026-08-18: `bot_paused` is GHL-owned, so every resync pushed the
  // bare boolean back and silently woke leads the bot had muted, leaving
  // `bot_pause_reason` behind as a ghost; an escalated lead re-escalated and
  // DM'd Eli twice within the hour.
  const table: [boolean, string | null, "refuse" | "pause" | "resume"][] = [
    [false, "opt_out", "refuse"],
    [false, "human_handoff", "refuse"],
    [false, "no_reply", "resume"],
    [false, "legacy", "resume"],
    [false, "escalation", "resume"],
    [false, null, "resume"],
    [true, "opt_out", "pause"],
    [true, null, "pause"],
  ];

  it.each(table)("ghl says paused=%s, current reason=%s → %s", (paused, reason, want) => {
    const r = ghlPauseChange(paused, reason);
    const got = r === null ? "refuse" : r.botPaused ? "pause" : "resume";
    expect(got).toBe(want);
  });

  it("a GHL pause is recorded as manual_toggle whatever the previous reason", () => {
    for (const reason of [...ALL_REASONS, null, undefined]) {
      expect(ghlPauseChange(true, reason)).toEqual(pauseFields("manual_toggle"));
    }
  });

  it("a GHL un-pause clears the reason columns", () => {
    const r = ghlPauseChange(false, "escalation");
    expect(r).not.toBeNull();
    expect(r!.botPaused).toBe(false);
    expect(r!.botPauseReason).toBeNull();
    expect(r!.botPausedAt).toBeNull();
  });

  it("the irrevocable set is exactly opt_out + human_handoff", () => {
    expect([...GHL_IRREVOCABLE_REASONS].sort()).toEqual(["human_handoff", "opt_out"]);
    for (const reason of ALL_REASONS) {
      const refused = ghlPauseChange(false, reason) === null;
      expect(refused).toBe(GHL_IRREVOCABLE_REASONS.has(reason));
    }
  });
});

describe("PAUSE_REASON_LABELS", () => {
  it("every reason has a non-empty Hebrew label", () => {
    for (const reason of ALL_REASONS) {
      expect(PAUSE_REASON_LABELS[reason]).toMatch(/[֐-׿]/);
    }
    expect(PAUSE_REASON_LABELS.opt_out).toBe("הלקוח ביקש להסיר");
    expect(PAUSE_REASON_LABELS.human_handoff).toBe("הלקוח ביקש בן אדם");
  });
});
