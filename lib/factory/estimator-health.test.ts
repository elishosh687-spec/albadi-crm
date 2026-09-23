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

  it("shows accuracy per factory once the refit judges them separately", () => {
    const h = assessEstimatorHealth({
      ...healthy,
      coeffs: { ...healthy.coeffs, factories: {
        Mandy: { accuracy: { medianPct: 4.5, maxPct: 22, n: 22 } },
        "亚森": { accuracy: { medianPct: 7.1, maxPct: 41, n: 10 } },
      } },
    }, NOW);
    expect(byId(h, "accuracy:Mandy")).toMatchObject({ status: "ok", label: "דיוק המחיר — MANDY" });
    expect(byId(h, "accuracy:亚森")).toMatchObject({ status: "warn", label: "דיוק המחיר — WEIWEI" });
    expect(h.checks.find((c) => c.id === "accuracy")).toBeUndefined();
  });

  it("one factory kept old while the other published → a warning naming which", () => {
    const h = assessEstimatorHealth({
      ...healthy,
      lastRefit: { result: { ...healthy.lastRefit!.result!, published: true, perFactory: [
        { factory: "Mandy", n: 22, newMedianPct: 4.5, publish: true, reason: "published" },
        { factory: "亚森", n: 10, newMedianPct: 7.3, publish: false, reason: "kept old — new median 7.3% > 6% gate" },
      ] } },
    }, NOW);
    const p = byId(h, "published");
    expect(p.status).toBe("warn");
    expect(p.detail).toContain("MANDY: עודכן");
    expect(p.detail).toContain("WEIWEI: הסטייה החדשה 7.3%");
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

  it("reports what the formula is built from as information, not a warning", () => {
    const h = assessEstimatorHealth({
      ...healthy,
      lastRefit: { result: { ...healthy.lastRefit!.result!, quotesLearned: 26, quotesGradingOnly: 65, quotesUnmodelled: 8 } },
    }, NOW);
    const l = byId(h, "learning");
    expect(l.status).toBe("ok");
    expect(l.detail).toContain("65 הצעות רגילות משמשות לבדיקת הדיוק");
    expect(l.detail).toContain("鼎驰");
    expect(h.status).toBe("ok");
  });

  it("before the first run that stores an outcome, the source line is pending", () => {
    const h = assessEstimatorHealth({ ...healthy, lastRefit: null }, NOW);
    expect(byId(h, "learning").detail).toContain("אחרי הכיול הבא");
  });
});
