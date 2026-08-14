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
  // Explicit flat format (H34*W40) → a real flat bag, depth 0. The old code
  // borrowed the 3D-model picker's d=0.35·min heuristic here, which INVENTED
  // a gusset the customer never asked for (Eli caught it: "34 על 40" was
  // quoted as H34*D12*W40).
  const flat = normalised.match(/^H(\d+(?:\.\d+)?)\*W(\d+(?:\.\d+)?)$/i);
  if (flat) return { h: Number(flat[1]), d: 0, w: Number(flat[2]) };
  const canonical = parseFactoryDimensions(normalised);
  if (canonical) return canonical;

  // Loose fallback: the first two or three numbers, in the factory's own
  // H → D → W order (that's the order the bot asks for).
  const nums = (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => n > 0);
  if (nums.length >= 3) return { h: nums[0], d: nums[1], w: nums[2] };
  if (nums.length === 2) {
    // Two bare numbers are AMBIGUOUS (flat? or depth omitted?). Never guess —
    // validateCustomDimsInput turns this into one clarifying question, so by
    // the time pricing runs the string is either H*D*W or explicit H*W.
    return { h: nums[0], d: 0, w: nums[1] };
  }
  return null;
}

export type DimsCheck =
  | { ok: true; dims: { h: number; d: number; w: number } }
  | { ok: false; message: string; needsDepth?: { h: number; w: number } };

/**
 * Validate what the customer typed for a custom size, AT THE MOMENT THEY TYPE IT.
 *
 * Without this the questionnaire accepted any text — "גובה 45" was taken as a
 * complete answer, the customer answered every remaining question, and only at
 * the very end did the missing dimensions surface as a 24-48h holding message.
 * The complaint belongs next to the mistake, and it should name what's missing
 * rather than repeat the format blurb.
 */
export function validateCustomDimsInput(raw: string): DimsCheck {
  const nums = ((raw ?? "").match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => n > 0);

  if (nums.length === 0) {
    return {
      ok: false,
      message:
        "לא הצלחתי לזהות מידות בהודעה 🙂\nתכתבו גובה, עומק ורוחב בס״מ — למשל H40*D15*W50, או פשוט: 40 15 50.\nלשקית שטוחה בלי עומק — גובה ורוחב בלבד, למשל H30*W40.",
    };
  }
  if (nums.length === 1) {
    return {
      ok: false,
      message:
        `קיבלתי ${nums[0]} ס״מ — אבל אני צריך את כל המידות כדי לתמחר.\n` +
        "גובה, עומק ורוחב — למשל H40*D15*W50 (או: 40 15 50).\n" +
        "אם השקית שטוחה בלי עומק — גובה ורוחב בלבד, למשל H30*W40.",
    };
  }

  // Two bare numbers ("34 על 40") — ambiguous: flat bag, or depth omitted?
  // Never invent the third dimension; ask ONE clarifying question. Explicit
  // flat notation (H34*W40) or a שטוח/flat word means the customer already
  // answered it.
  const explicitFlat = /H\s*\d+\s*[*×xX]\s*W\s*\d+/i.test(raw) || /שטוח/.test(raw);
  if (nums.length === 2 && !explicitFlat) {
    return { ok: false, message: "", needsDepth: { h: nums[0], w: nums[1] } };
  }

  const dims = parseCustomDims(raw);
  if (!dims) {
    return {
      ok: false,
      message:
        "לא הצלחתי לקרוא את המידות. אפשר לכתוב אותן בפורמט H40*D15*W50 (גובה, עומק, רוחב בס״מ)?",
    };
  }

  // Catch an unmakeable bag now, while the customer is still thinking about
  // dimensions — not after they've answered everything else.
  const geometryErrors = validateBagGeometry(dims.w, dims.d, dims.h);
  if (geometryErrors.length > 0) {
    return {
      ok: false,
      message:
        `המידות האלה מחוץ לטווח שהמפעל מייצר:\n${geometryErrors.map((e) => `• ${e}`).join("\n")}\n` +
        "אפשר לכתוב מידות מעודכנות?",
    };
  }

  return { ok: true, dims };
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

/** The one clarifying question for two-number input. */
export function depthQuestion(p: { h: number; w: number }): string {
  return (
    `קיבלתי ${p.h}×${p.w} ס״מ ✔️\n` +
    "יש לשקית גם עומק (מכפל בצדדים)? אם כן — תכתבו רק את מספר העומק בס״מ (למשל 12).\n" +
    'אם היא שטוחה בלי עומק — תכתבו "שטוחה".'
  );
}

export const DEPTH_REASK =
  'רק כדי לסגור את המידה — תכתבו את מספר העומק בס״מ (למשל 12), או "שטוחה" אם אין עומק.';

/**
 * Interpret the customer's answer to the depth question. Returns the full
 * canonical dims string, or null when the answer is neither a depth nor a
 * flat-bag confirmation.
 */
export function resolveDepthAnswer(
  raw: string,
  partial: { h: number; w: number }
): string | null {
  const t = (raw ?? "").trim();
  if (/שטוח|בלי עומק|אין עומק|^אין$|^לא$/.test(t)) return `H${partial.h}*W${partial.w}`;
  const nums = (t.match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => n > 0);
  if (nums.length === 1) return `H${partial.h}*D${nums[0]}*W${partial.w}`;
  // Customer re-sent all three dims — take them wholesale.
  if (nums.length >= 3) return `H${nums[0]}*D${nums[1]}*W${nums[2]}`;
  return null;
}
