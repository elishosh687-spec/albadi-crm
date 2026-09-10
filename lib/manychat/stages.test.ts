/**
 * lib/manychat/stages.ts — the client-safe stage vocabulary.
 * Pins the 2026-06-07 rename rule ("ADD the old name to LEGACY_STAGE_MAP,
 * never remove") and the 2026-07-01 relabel to Eli's working words.
 */
import { describe, expect, it } from "vitest";
import {
  LEGACY_STAGE_MAP,
  V2_ASSIGNABLE_STAGES,
  V2_FLAG_NAMES,
  V2_FLAG_TAG_IDS,
  V2_PIPELINE_STAGES,
  V2_SIDE_STAGES,
  V2_STAGE_LABELS,
  flagHasNumericId,
  normalizeStage,
} from "./stages";

describe("normalizeStage", () => {
  it("returns a canonical stage unchanged", () => {
    for (const s of V2_PIPELINE_STAGES) expect(normalizeStage(s)).toBe(s);
  });

  // 2026-06-07 funnel rename — stale DB rows / logs / GHL payloads still parse.
  it("maps every legacy name through LEGACY_STAGE_MAP", () => {
    expect(normalizeStage("INITIAL_QUOTE_SENT")).toBe("INTAKE");
    expect(normalizeStage("AWAITING_FIRST_RESPONSE")).toBe("INTAKE");
    expect(normalizeStage("SHOWED_INTEREST")).toBe("DISCAVERY");
    expect(normalizeStage("FACTORY_CHECK")).toBe("FACTORY_WAIT");
    expect(normalizeStage("FINAL_QUOTE_SENT")).toBe("CONSIDERATION");
    expect(normalizeStage("NEGOTIATING")).toBe("CONSIDERATION");
    expect(normalizeStage("DROPPED")).toBe("LOST");
    expect(normalizeStage("CALLBACK_LATER")).toBe("DISCAVERY");
  });

  it("NEW means 'no stage yet' (questionnaire running) → null", () => {
    expect(normalizeStage("NEW")).toBeNull();
    expect("NEW" in LEGACY_STAGE_MAP).toBe(true);
  });

  // Deliberate: side stages are NOT funnel stages, and the bot's funnel logic
  // must never see them. Anything routing a side stage through here loses it.
  it("side stages normalise to null BY DESIGN", () => {
    for (const s of V2_SIDE_STAGES) expect(normalizeStage(s)).toBeNull();
  });

  it("unknown / empty input → null", () => {
    expect(normalizeStage("GARBAGE")).toBeNull();
    expect(normalizeStage("intake")).toBeNull(); // case-sensitive on purpose
    expect(normalizeStage("")).toBeNull();
    expect(normalizeStage(null)).toBeNull();
    expect(normalizeStage(undefined)).toBeNull();
  });

  it("every LEGACY_STAGE_MAP value is null or a canonical stage", () => {
    for (const [k, v] of Object.entries(LEGACY_STAGE_MAP)) {
      expect(v === null || (V2_PIPELINE_STAGES as readonly string[]).includes(v), k).toBe(true);
    }
  });
});

describe("V2_STAGE_LABELS — Eli's vocabulary (2026-07-01)", () => {
  it("covers all 8 assignable stages with non-empty Hebrew", () => {
    expect(V2_ASSIGNABLE_STAGES).toHaveLength(8);
    for (const s of V2_ASSIGNABLE_STAGES) {
      expect(V2_STAGE_LABELS[s], s).toMatch(/[֐-׿]/);
    }
    expect(Object.keys(V2_STAGE_LABELS).sort()).toEqual([...V2_ASSIGNABLE_STAGES].sort());
  });

  it("uses the 2026-07-01 words, not the old long ones", () => {
    expect(V2_STAGE_LABELS.INTAKE).toBe("קליטה");
    expect(V2_STAGE_LABELS.DISCAVERY).toBe("אפיון");
    expect(V2_STAGE_LABELS.FACTORY_WAIT).toBe("מחכה למפעל");
    expect(V2_STAGE_LABELS.CONSIDERATION).toBe("שוקל / משא ומתן");
    expect(V2_STAGE_LABELS.LOST).toBe("אבוד");
    expect(V2_STAGE_LABELS.FUTURE_FOLLOW_UP).toBe("להתקשר בעתיד");
  });
});

describe("flags", () => {
  // A flag name without a numeric id once broke the build (actions/v2.ts
  // indexed V2_FLAG_TAG_IDS by name) — keep the two lists consistent.
  it("flagHasNumericId ⇔ the name is a key of V2_FLAG_TAG_IDS", () => {
    for (const name of V2_FLAG_NAMES) {
      expect(flagHasNumericId(name)).toBe(name in V2_FLAG_TAG_IDS);
    }
    expect(flagHasNumericId("דחוף")).toBe(true);
    expect(flagHasNumericId("לקוח_חם")).toBe(false);
  });
});
