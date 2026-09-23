import { describe, it, expect } from "vitest";
import { dedupeQuotes, quoteKey, buildModel, predict, type Pt } from "./estimator-fit";

const q = (size: string, price: number, extra: Partial<Pt> = {}): Pt => ({
  factory: "亚森", size, area: 0, colors: 1, hasHandle: false, hasLam: false, qty: 3000, price, src: "quote", ...extra,
});

describe("quote dedupe — the same quote lives in the Feishu log AND the DB", () => {
  it("collapses spelling variants of one size and averages the price", () => {
    const out = dedupeQuotes([q("H40*D10*W40", 1.2), q("H40 * D10 * W40", 1.4, { src: "db" }), q("H40*D10*W40", 1.0, { qty: 5000 })]);
    expect(out).toHaveLength(2);
    expect(out.find((p) => p.qty === 3000)!.price).toBeCloseTo(1.3);
    expect(quoteKey(q("H40*D10*W40", 1))).toBe(quoteKey(q("H40 * D10 * W40", 9)));
  });
});

describe("learnPlain — flat, tray and narrow-tall quotes never bend the gusseted line", () => {
  // Catalog: two 1-colour, no-handle, plain sizes at 3000 → a clean line.
  const cat: Pt[] = [
    { ...q("H30*D10*W30", 0.8), area: 2700, src: "catalog" },
    { ...q("H40*D15*W50", 1.2), area: 5750, src: "catalog" },
  ];
  const at = (m: ReturnType<typeof buildModel>, area: number) => predict(m, { area, qty: 3000, hasHandle: false, hasLam: false, colors: 1 })!.unit;

  it("a wild flat-bag quote leaves the line exactly as the catalog drew it", () => {
    const flat = { ...q("H40*W30", 3.0), area: 2400 };                  // D=0 — the estimator refuses flat bags
    const narrow = { ...q("H50*D9*W33", 3.0), area: 4497 };             // wine shape — refused too
    const base = buildModel(cat, [], "亚森");
    const learnt = buildModel(cat, [flat, narrow], "亚森", undefined, { learnPlain: true });
    expect(at(learnt, 4000)).toBeCloseTo(at(base, 4000), 6);
  });

  it("a gusseted plain quote does move it", () => {
    const g = { ...q("H35*D12*W40", 1.6), area: 4060 };
    const base = buildModel(cat, [], "亚森");
    const learnt = buildModel(cat, [g], "亚森", undefined, { learnPlain: true });
    expect(at(learnt, 4060)).toBeGreaterThan(at(base, 4060));
  });
});
