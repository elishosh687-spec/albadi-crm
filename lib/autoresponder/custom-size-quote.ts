/**
 * Instant price for an off-catalog size.
 *
 * Until now a customer who typed their own dimensions got "we'll get back to
 * you within 24-48 hours" and Eli priced it by hand — even though the estimator
 * that can price arbitrary H·D·W has existed for months, just never wired to
 * the bot. This is that wire.
 *
 * The estimate is ~±10% and is labelled as an estimate to the customer. Where
 * it can't be trusted — dimensions the factory's machines can't make, a spec
 * outside the trained envelope, a parse failure — we fall back to the existing
 * factory/human path rather than inventing a number.
 */
import { parseFactoryDimensions } from "../configurator/bag-models";
import { validateBagGeometry } from "../factory/bag-geometry";
import { estimateQuoteForSpec } from "../factory/server/estimate-quote";
import type { QuoteResult } from "../factory/calculator/types";

export interface CustomSizeInput {
  /** Raw text the customer typed, e.g. "H38*D12*W42" or "38 על 12 על 42". */
  dimsText: string;
  quantity: number;
  hasHandles: boolean;
  hasLamination: boolean;
  logoColors: number;
  shippingOptionId: string;
}

export type CustomSizeOutcome =
  | { ok: true; result: QuoteResult; altResult: QuoteResult | null; dims: string; confidence: string }
  | { ok: false; reason: "unparseable" | "geometry" | "refused"; detail: string };

/**
 * Pull H/D/W out of whatever the customer wrote.
 *
 * The canonical form is `H40*D15*W50` (the spec-extractor normalises to it),
 * but customers type freely, so a loose "three numbers" pass follows. Two
 * numbers are read as a flat bag, matching parseFactoryDimensions.
 */
export function parseCustomDims(
  raw: string
): { h: number; d: number; w: number } | null {
  const text = (raw ?? "").trim();
  if (!text) return null;

  // Canonical / near-canonical first (handles ×, x and spacing).
  const normalised = text.replace(/[×xX]/g, "*").replace(/\s*\*\s*/g, "*");
  const canonical = parseFactoryDimensions(normalised);
  if (canonical) return canonical;

  // Loose fallback: the first two or three numbers, in the factory's own
  // H → D → W order (that's the order the bot asks for).
  const nums = (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => n > 0);
  if (nums.length >= 3) return { h: nums[0], d: nums[1], w: nums[2] };
  if (nums.length === 2) {
    const [h, w] = nums;
    // Same flat-bag convention parseFactoryDimensions uses.
    return { h, d: Math.min(h, w) * 0.35, w };
  }
  return null;
}

export async function quoteCustomSize(
  input: CustomSizeInput
): Promise<CustomSizeOutcome> {
  const dims = parseCustomDims(input.dimsText);
  if (!dims) {
    return { ok: false, reason: "unparseable", detail: input.dimsText };
  }

  // The factory's machines have hard limits. Quoting a bag they can't make is
  // worse than saying "let me check" — it's a price we'd have to walk back.
  const geometryErrors = validateBagGeometry(dims.w, dims.d, dims.h);
  if (geometryErrors.length > 0) {
    return { ok: false, reason: "geometry", detail: geometryErrors.join(" · ") };
  }

  const out = await estimateQuoteForSpec({
    spec: {
      widthCm: dims.w,
      heightCm: dims.h,
      depthCm: dims.d,
      quantity: input.quantity,
      hasHandles: input.hasHandles,
      hasLamination: input.hasLamination,
      logoColors: input.logoColors,
    },
    shippingOptionId: input.shippingOptionId,
  });

  if (!out.ok || !out.result) {
    return { ok: false, reason: "refused", detail: out.refused ?? "לא ניתן לאמוד" };
  }

  return {
    ok: true,
    result: out.result,
    altResult: out.altResult ?? null,
    dims: `H${dims.h}${dims.d ? `*D${Math.round(dims.d)}` : ""}*W${dims.w}`,
    confidence: out.estimate.confidence ?? "medium",
  };
}
