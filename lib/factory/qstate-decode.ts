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

export const PRODUCT_LABEL: Record<string, string> = {
  p1: "20×8×25 ס״מ — קוסמטיקה, תכשיטים",
  p2: "30×10×30 ס״מ — ביגוד קל, מתנות",
  p3: "40×12×30 ס״מ — נעליים, ביגוד",
  p4: "40×15×50 ס״מ — פריטים גדולים",
  p5: "30×40 ס״מ — פריטים רחבים",
  p6: "20×15 ס״מ — פריטים קטנים",
};

/** Approximate width/height/depth in cm parsed from a known product code. */
export const PRODUCT_DIMS: Record<
  string,
  { widthCm: number; heightCm: number; depthCm: number }
> = {
  p1: { widthCm: 20, heightCm: 25, depthCm: 8 },
  p2: { widthCm: 30, heightCm: 30, depthCm: 10 },
  p3: { widthCm: 40, heightCm: 30, depthCm: 12 },
  p4: { widthCm: 40, heightCm: 50, depthCm: 15 },
  p5: { widthCm: 30, heightCm: 40, depthCm: 0 },
  p6: { widthCm: 20, heightCm: 15, depthCm: 0 },
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
  logoColors: number;
  shippingOptionCode: string | null;
  rawProduct: string;
  rawShipping: string;
}

export function decodeQStateToSpec(
  q: Record<string, unknown> | null | undefined
): DecodedQStateSpec | null {
  if (!q) return null;
  const productCode = String(q.product ?? "");
  const productCustom = q.productCustom ? String(q.productCustom) : "";
  const dims =
    productCode === "custom" || !PRODUCT_DIMS[productCode]
      ? { widthCm: 0, heightCm: 0, depthCm: 0 }
      : PRODUCT_DIMS[productCode];
  const description =
    productCode === "custom" && productCustom
      ? productCustom
      : PRODUCT_LABEL[productCode] ?? "";

  const quantityCode = String(q.quantity ?? "");
  const quantityCustom = q.quantityCustom ? Number(q.quantityCustom) : 0;
  const quantity =
    quantityCode === "custom" && quantityCustom > 0
      ? quantityCustom
      : QUANTITY_VALUE[quantityCode] ?? 0;

  const handlesRaw = q.handles;
  const hasHandles = handlesRaw === true || handlesRaw === "true";

  const colorsNum = Number(q.colors);
  const logoColors = Number.isFinite(colorsNum) && colorsNum > 0 ? colorsNum : 1;

  const shippingCode = q.shipping ? String(q.shipping) : null;

  // Has any meaningful answer?
  const hasData =
    description !== "" ||
    quantity > 0 ||
    handlesRaw !== undefined ||
    q.colors !== undefined ||
    shippingCode !== null;
  if (!hasData) return null;

  return {
    description,
    ...dims,
    quantity,
    hasHandles,
    logoColors,
    shippingOptionCode: shippingCode,
    rawProduct: productCode,
    rawShipping: shippingCode ?? "",
  };
}
