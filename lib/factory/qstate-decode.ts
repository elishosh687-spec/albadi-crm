/**
 * Maps the bot's questionnaire option-codes to human labels. Source of truth:
 * lib/autoresponder/questionnaire.ts QUESTIONS array. Keep these in sync if the
 * bot's option list changes.
 */

export const SHIPPING_LABEL: Record<string, string> = {
  s1: "✈️ אקספרס (~25 יום)",
  s2: "🚢 רגיל (~90 יום)",
};

export const QUANTITY_LABEL: Record<string, string> = {
  q0: "1,000 יח׳",
  q1: "3,000 יח׳",
  q2: "5,000 יח׳",
  q3: "10,000 יח׳",
};

// Canonical factory format: H{height}*D{depth}*W{width} (depth omitted for
// flat bags). Source of truth: lib/factory/calculator/constants.ts. Synced
// with QUESTIONS / PRODUCT_QUESTION_PAGE_2 in lib/autoresponder/questionnaire.ts.
export const PRODUCT_LABEL: Record<string, string> = {
  p1: "H20*D8*W25 ס״מ — קוסמטיקה, תכשיטים",
  p2: "H30*D10*W30 ס״מ — ביגוד קל, מתנות",
  p3: "H30*D12*W40 ס״מ — נעליים, ביגוד",
  p4: "H40*D15*W50 ס״מ — פריטים גדולים",
  p5: "H30*W40 ס״מ — שטוח רחב",
  p6: "H15*W20 ס״מ — שטוח קטן",
  p7: "H15*D5*W20 ס״מ — קטן צר, יוקרה",
  p8: "H35*D10*W40 ס״מ — בינוני-גדול",
  p9: "H40*D15*W45 ס״מ — גדול",
  p12: "H10*W15 ס״מ — שטוח קטן",
  p13: "H25*W25 ס״מ — ריבועי",
};

/** Approximate width/height/depth in cm parsed from a known product code. */
export const PRODUCT_DIMS: Record<
  string,
  { widthCm: number; heightCm: number; depthCm: number }
> = {
  p1: { widthCm: 25, heightCm: 20, depthCm: 8 },
  p2: { widthCm: 30, heightCm: 30, depthCm: 10 },
  p3: { widthCm: 40, heightCm: 30, depthCm: 12 },
  p4: { widthCm: 50, heightCm: 40, depthCm: 15 },
  p5: { widthCm: 40, heightCm: 30, depthCm: 0 },
  p6: { widthCm: 20, heightCm: 15, depthCm: 0 },
  p7: { widthCm: 20, heightCm: 15, depthCm: 5 },
  p8: { widthCm: 40, heightCm: 35, depthCm: 10 },
  p9: { widthCm: 45, heightCm: 40, depthCm: 15 },
  p12: { widthCm: 15, heightCm: 10, depthCm: 0 },
  p13: { widthCm: 25, heightCm: 25, depthCm: 0 },
};

export const QUANTITY_VALUE: Record<string, number> = {
  q0: 1000,
  q1: 3000,
  q2: 5000,
  q3: 10000,
};

export function decodeShipping(v: unknown): string {
  const s = String(v ?? "");
  return SHIPPING_LABEL[s] ?? s;
}

export function decodeQuantity(v: unknown, custom?: unknown): string {
  const s = String(v ?? "");
  if (s === "custom" && custom) return `${String(custom)} יח׳ (מותאם)`;
  return QUANTITY_LABEL[s] ?? s;
}

export function decodeProduct(v: unknown, custom?: unknown): string {
  const s = String(v ?? "");
  if (s === "custom" && custom) return `${String(custom)} (מותאם)`;
  return PRODUCT_LABEL[s] ?? s;
}

export function decodeHandles(v: unknown): string {
  if (v === true || v === "true") return "עם ידיות";
  if (v === false || v === "false") return "ללא ידיות";
  return "—";
}

export function decodeColors(v: unknown): string {
  const n = Number(v);
  if (Number.isFinite(n) && n > 0) {
    return n === 1 ? "צבע אחד" : `${n} צבעים`;
  }
  return "—";
}

// English-spec → Hebrew display. The English strings are produced in
// app/api/factory/quote-request/route.ts and SendToFactoryForm.tsx so the
// Chinese factory can read them; for the customer PDF and the internal
// finalized panel we present them in Hebrew.
export function humanizePrinting(en: string): string {
  // "1 color(s)" / "2 color" / "3+ color(s)" / "3+ colors"
  const m = en.match(/^(\d+\+?)\s*colors?/i);
  if (!m) return en;
  if (m[1] === "1") return "צבע אחד";
  return `${m[1]} צבעים`;
}

export function humanizeFinishing(en: string): string {
  const handles = /with handles/i.test(en);
  const noHandles = /no handles|without handles/i.test(en);
  const notLam = /not laminated/i.test(en);
  const laminated = /laminated/i.test(en) && !notLam;
  const parts: string[] = [];
  if (handles) parts.push("עם ידיות");
  else if (noHandles) parts.push("ללא ידיות");
  if (laminated) parts.push("עם למינציה");
  else if (notLam) parts.push("ללא למינציה");
  return parts.length ? parts.join(", ") : en;
}

// Common factory material phrases → Hebrew. Longest/most-specific first so a
// whole phrase ("food grade white card") wins over its parts ("white", "card").
const MATERIAL_TERMS: [RegExp, string][] = [
  [/(\d+)\s*gsm/gi, "$1 גרם"],
  [/food[\s-]?grade\s+white\s+card(board)?/gi, "קרטון לבן למגע מזון"],
  [/food[\s-]?grade/gi, "למגע מזון"],
  [/white\s+card(board)?/gi, "קרטון לבן"],
  [/non[\s-]?woven/gi, "נון-וובן"],
  [/kraft\s+paper/gi, "נייר קראפט"],
  [/kraft/gi, "קראפט"],
  [/art\s+paper/gi, "נייר כרומו"],
  [/coated\s+paper/gi, "נייר מצופה"],
  [/couche/gi, "קושה"],
  [/ivory\s+board/gi, "קרטון אייבורי"],
  [/ivory/gi, "אייבורי"],
  [/corrugated/gi, "קרטון גלי"],
  [/card\s?board/gi, "קרטון"],
  [/\bcard\b/gi, "קרטון"],
  [/cotton/gi, "כותנה"],
  [/canvas/gi, "קנבס"],
  [/coated/gi, "מצופה"],
  [/matte?/gi, "מט"],
  [/glossy|gloss/gi, "מבריק"],
  [/paper/gi, "נייר"],
  [/white/gi, "לבן"],
  [/\bpp\b/gi, "פוליפרופילן"],
];

export function humanizeMaterial(en: string): string {
  // "250g food grade white card" → "250 גרם קרטון לבן למגע מזון".
  // Pull a leading gram weight, then translate the rest to Hebrew.
  let rest = en;
  let weight = "";
  const m = rest.match(/^(\d+)\s*g\b\s*/i);
  if (m) {
    weight = `${m[1]} גרם`;
    rest = rest.slice(m[0].length);
  }
  for (const [re, he] of MATERIAL_TERMS) rest = rest.replace(re, he);
  rest = rest.replace(/\s+/g, " ").trim();
  return [weight, rest].filter(Boolean).join(" ");
}

export function formatHebrewDate(iso: unknown): string {
  if (!iso) return "—";
  const d = new Date(String(iso));
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("he-IL", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Resolved spec snapshot from bot questionnaire — used as preset values for
 * the manual factory form and for rendering the order-summary spec view.
 */
export interface DecodedQStateSpec {
  description: string;
  widthCm: number;
  heightCm: number;
  depthCm: number;
  quantity: number;
  hasHandles: boolean;
  hasLamination: boolean;
  logoColors: number;
  shippingOptionCode: string | null;
  rawProduct: string;
  rawShipping: string;
}

/**
 * Parse a free-text dimension string from the customer ("10×35×10",
 * "H10*D35*W10", "H30*W40" ...) into the W/H/D axes. Returns zeros if
 * nothing parsable was found — caller falls back to standard PRODUCT_DIMS.
 * Same axis convention as the factory: H = height, D = depth, W = width.
 */
function parseProductCustomDims(raw: string): {
  widthCm: number;
  heightCm: number;
  depthCm: number;
} {
  if (!raw) return { widthCm: 0, heightCm: 0, depthCm: 0 };
  const labeled = /[HhWwDd]\s*\d/.test(raw);
  if (labeled) {
    const out = { widthCm: 0, heightCm: 0, depthCm: 0 };
    for (const m of raw.matchAll(/([HhWwDd])\s*(\d+(?:\.\d+)?)/g)) {
      const v = parseFloat(m[2]);
      if (!Number.isFinite(v)) continue;
      const letter = m[1].toUpperCase();
      if (letter === "H") out.heightCm = v;
      else if (letter === "W") out.widthCm = v;
      else if (letter === "D") out.depthCm = v;
    }
    return out;
  }
  // Legacy numeric: W×D×H for 3D, W×H for 2D.
  const nums = raw
    .split(/[×*xX]/)
    .map((s) => parseFloat(s.replace(/[^0-9.]/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (nums.length === 3) return { widthCm: nums[0], depthCm: nums[1], heightCm: nums[2] };
  if (nums.length === 2) return { widthCm: nums[0], depthCm: 0, heightCm: nums[1] };
  return { widthCm: 0, heightCm: 0, depthCm: 0 };
}

export function decodeQStateToSpec(
  q: Record<string, unknown> | null | undefined
): DecodedQStateSpec | null {
  if (!q) return null;
  const productCode = String(q.product ?? "");
  const productCustom = q.productCustom ? String(q.productCustom) : "";
  let dims: { widthCm: number; heightCm: number; depthCm: number };
  if (productCode === "custom") {
    dims = parseProductCustomDims(productCustom);
  } else if (PRODUCT_DIMS[productCode]) {
    dims = PRODUCT_DIMS[productCode];
  } else {
    dims = { widthCm: 0, heightCm: 0, depthCm: 0 };
  }
  // Description always blank — the size column already renders the dims
  // as H*D*W (via lib/factory/create-request.sizeLabel). The operator
  // fills description manually with real free-text notes (logo
  // placement, urgency, etc.) before sending to Feishu.
  const description = "";

  const quantityCode = String(q.quantity ?? "");
  const quantityCustom = q.quantityCustom ? Number(q.quantityCustom) : 0;
  const quantity =
    quantityCode === "custom" && quantityCustom > 0
      ? quantityCustom
      : QUANTITY_VALUE[quantityCode] ?? 0;

  const handlesRaw = q.handles;
  const hasHandles = handlesRaw === true || handlesRaw === "true";

  const laminationRaw = q.lamination;
  const hasLamination = laminationRaw === true || laminationRaw === "true";

  const colorsNum = Number(q.colors);
  const logoColors = Number.isFinite(colorsNum) && colorsNum > 0 ? colorsNum : 1;

  const shippingCode = q.shipping ? String(q.shipping) : null;

  // Has any meaningful answer?
  const hasData =
    description !== "" ||
    quantity > 0 ||
    handlesRaw !== undefined ||
    laminationRaw !== undefined ||
    q.colors !== undefined ||
    shippingCode !== null;
  if (!hasData) return null;

  return {
    description,
    ...dims,
    quantity,
    hasHandles,
    hasLamination,
    logoColors,
    shippingOptionCode: shippingCode,
    rawProduct: productCode,
    rawShipping: shippingCode ?? "",
  };
}

/**
 * Map a decoded qState into the FactoryProductSpec shape consumed by
 * `POST /api/factory/quote-request`. Used by:
 *   - FactoryQuotePanel "send from summary" (default current qState)
 *   - QuoteHistory "promote a historical quote → factory request"
 * Centralizing keeps the two surfaces in sync if the spec shape changes.
 */
export interface FactoryProductSpecLike {
  description: string;
  material: string;
  widthCm: number;
  heightCm: number;
  depthCm: number;
  quantity: number;
  printing: string;
  finishing: string;
  notes?: string;
  shippingOptionId?: string;
}

export function qStateToFactoryProductSpec(
  q: Record<string, unknown> | null | undefined
): FactoryProductSpecLike | null {
  const decoded = decodeQStateToSpec(q);
  if (!decoded) return null;
  return {
    // Left blank so the operator fills the customer-facing description on
    // the FactoryQuotePanel draft row before sending to Feishu. Dimensions
    // are already captured in widthCm/heightCm/depthCm and re-rendered as
    // H*D*W by lib/factory/create-request.sizeLabel, so this field is a
    // free-text note (e.g. "logo on front, gold print") rather than a dim
    // restatement.
    description: "",
    material: "80g non-woven",
    widthCm: decoded.widthCm,
    heightCm: decoded.heightCm,
    depthCm: decoded.depthCm,
    quantity: decoded.quantity,
    printing: `${decoded.logoColors} color${decoded.logoColors > 1 ? "s" : ""}`,
    finishing: `${decoded.hasHandles ? "With handles" : "No handles"} / ${
      decoded.hasLamination ? "Laminated" : "Not laminated"
    }`,
    // Customer's actual shipping pick from the questionnaire. Carried into
    // FactoryQuotePanel/FinalizeModal so finalize defaults to it instead of
    // the first-enabled fallback (which used to land on express).
    ...(decoded.shippingOptionCode
      ? { shippingOptionId: decoded.shippingOptionCode }
      : {}),
  };
}
