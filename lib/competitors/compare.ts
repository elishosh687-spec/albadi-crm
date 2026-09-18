/**
 * Pure comparison maths for the מחיר מתחרים tab (ui-ux-pro-max redesign,
 * 18/09): who is cheaper on the ORDER, by how much, in words — and the summary
 * across rows. Our side is always the LIVE price from the calculator
 * (`/api/widget/competitor-prices/our-side`), never the hand-typed `ourPrice`
 * field (almost always empty, which is why "זולים יותר" showed "—").
 */

export interface GapVerdict {
  /** "good" = we are cheaper; "bad" = we are dearer; "even" = within 1%. */
  tone: "good" | "bad" | "even";
  /** ILS difference on the whole order, always positive. */
  amount: number;
  /** Difference as % of THEIR order total, rounded. */
  pct: number;
  text: string;
}

const nisWhole = (n: number) => "₪" + Math.round(n).toLocaleString("he-IL");

/** Order-level verdict. Null when either side has no total. */
export function gapVerdict(theirsTotal: number | null, ourTotal: number | null): GapVerdict | null {
  if (theirsTotal == null || ourTotal == null || theirsTotal <= 0) return null;
  const diff = theirsTotal - ourTotal;
  const pct = Math.round((Math.abs(diff) / theirsTotal) * 100);
  if (pct < 1) return { tone: "even", amount: Math.abs(diff), pct, text: "אותו מחיר" };
  return diff > 0
    ? { tone: "good", amount: diff, pct, text: `אנחנו זולים ב־${nisWhole(diff)} (${pct}%)` }
    : { tone: "bad", amount: -diff, pct, text: `אנחנו יקרים ב־${nisWhole(-diff)} (${pct}%)` };
}

export interface CompareSummary {
  /** Rows where both sides have an order total. */
  compared: number;
  cheaper: number;
  dearer: number;
  /** Mean ILS we save the customer per order (negative = we cost more). */
  avgSaving: number | null;
}

export function summarize(verdicts: (GapVerdict | null)[]): CompareSummary {
  const v = verdicts.filter((x): x is GapVerdict => x != null);
  const signed = v.map((x) => (x.tone === "bad" ? -x.amount : x.tone === "good" ? x.amount : 0));
  return {
    compared: v.length,
    cheaper: v.filter((x) => x.tone === "good").length,
    dearer: v.filter((x) => x.tone === "bad").length,
    avgSaving: v.length ? Math.round(signed.reduce((a, b) => a + b, 0) / v.length) : null,
  };
}
