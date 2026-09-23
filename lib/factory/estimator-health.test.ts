import { describe, it, expect } from "vitest";
import { assessEstimatorHealth, type EstimatorHealthInput } from "./estimator-health";

const NOW = new Date("2026-09-22T12:00:00Z");
const healthy: EstimatorHealthInput = {
  job: { health: "ok", minutesSinceOk: 480 },
  coeffs: {
    fittedAt: "2026-09-22",
    accuracy: { medianPct: 4.5, maxPct: 40.8, n: 32 },
    carton: { fittedAt: "2026-09-22", accuracy: { medianPct: 8.2, maxPct: 30, n: 37 } },
  },
  lastRefit: {
    ranAt: "2026-09-22T04:00:52Z",
    result: {
      published: true, reason: "published", catalogPoints: 166, quoteLogPoints: 57, dbPoints: 34,
      cartonMedianPct: 8.2, cartonPublished: true,
      quotesLearned: 26, quotesGradingOnly: 0, quotesUnmodelled: 0,
    },
  },
};
const byId = (h: ReturnType<typeof assessEstimatorHealth>, id: string) => h.checks.find((c) => c.id === id)!;

describe("estimator health — the settings 'דיוק המחשבון' screen", () => {
  it("all green when the job ran, published, and passes both gates", () => {
    const h = assessEstimatorHealth(healthy, NOW);
    expect(h.status).toBe("ok");
    expect(h.checks.map((c) => c.status)).toEqual(["ok", "ok", "ok", "ok", "ok"]);
  });

  it("a dead cron is a FAIL, not silence (the 2026-06-24 → 09-09 outage)", () => {
    const h = assessEstimatorHealth({ ...healthy, job: { health: "late", minutesSinceOk: 11 * 7 * 1440 } }, NOW);
    expect(h.status).toBe("fail");
    expect(byId(h, "runs").detail).toContain("לא רץ");
  });

  it("a failed run shows its error", () => {
    const h = assessEstimatorHealth({ ...healthy, job: { health: "failed", minutesSinceOk: 2000, lastError: "feishu export timed out" } }, NOW);
    expect(byId(h, "runs")).toMatchObject({ status: "fail" });
    expect(byId(h, "runs").detail).toContain("feishu export timed out");
  });

  it("kept-old formulas are a warning with the reason in Hebrew", () => {
    const h = assessEstimatorHealth({
      ...healthy,
      coeffs: { ...healthy.coeffs, fittedAt: "2026-09-10" },
      lastRefit: { result: { ...healthy.lastRefit!.result!, published: false, reason: "kept old — new median 7.3% > 6% gate" } },
    }, NOW);
    expect(byId(h, "published").status).toBe("warn");
    expect(byId(h, "published").detail).toContain("7.3%");
    expect(byId(h, "published").detail).toContain("12 ימים");
  });

  it("flags the carton model frozen behind the price fit (live state 2026-09-22)", () => {
    const h = assessEstimatorHealth({
      ...healthy,
      coeffs: { ...healthy.coeffs, carton: { fittedAt: "2026-09-10", accuracy: { medianPct: 10.6, maxPct: 60.3, n: 37 } } },
      lastRefit: { result: { ...healthy.lastRefit!.result!, cartonMedianPct: 10.6, cartonPublished: false } },
    }, NOW);
    expect(byId(h, "carton").status).toBe("warn");
    expect(byId(h, "carton").detail).toContain("10.6%");
  });

  it("says out loud that plain-bag quotes only grade the model", () => {
    const h = assessEstimatorHealth({
      ...healthy,
      lastRefit: { result: { ...healthy.lastRefit!.result!, quotesLearned: 26, quotesGradingOnly: 65, quotesUnmodelled: 8 } },
    }, NOW);
    const l = byId(h, "learning");
    expect(l.status).toBe("warn");
    expect(l.detail).toContain("65 הצעות רגילות רק בודקות");
    expect(l.detail).toContain("鼎驰");
  });

  it("before the first run that stores an outcome, learning is pending — not green", () => {
    const h = assessEstimatorHealth({ ...healthy, lastRefit: null }, NOW);
    expect(byId(h, "learning").status).toBe("warn");
  });
});
