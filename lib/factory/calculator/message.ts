/**
 * Hebrew quote message template — ported from
 * bag-quote-app/lib/i18n/manychat-messages.ts (Hebrew branch only) +
 * formatPrice from lib/i18n/currency.ts.
 *
 * Used by the bot in lib/autoresponder/questionnaire.ts after the local
 * calculator returns the result.
 */

import { customerRoundedTotalIls } from "./customer-breakdown";

const SYMBOLS: Record<string, string> = {
  ILS: "₪",
  EUR: "€",
  GBP: "£",
  USD: "$",
};

function formatPrice(amount: number, currencyCode: string): string {
  const symbol = SYMBOLS[currencyCode] ?? currencyCode + " ";
  const formatted = amount.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return symbol + formatted;
}

export interface QuoteMessageParams {
  dimensions: string;
  hasHandles: boolean;
  hasLamination: boolean;
  quantity: number;
  logoColors: number;
  shippingName: string;
  shippingDays: number | string;
  pricePerUnit: number;
  totalOrder: number;
  /**
   * One-time plate/mold fee in ILS, already converted by the engine
   * (`moldsTotalSellingPriceIls`). Printed as its own line and added to the
   * total — the per-unit price never carries it, so without the line the
   * customer's own "ליחידה × כמות" would not reach the total we print.
   */
  moldsIls?: number;
  currency: string;
  appUrl: string;
  alt?: {
    shippingName: string;
    shippingDays: number | string;
    pricePerUnit: number;
    totalOrder: number;
  } | null;
  /** Bot setting — false hides the "💡 חלופה" block. Default true. */
  showAlternative?: boolean;
  /** Bot setting — empty string omits the booking invitation entirely. */
  bookingUrl?: string;
  /** Off-catalog sizes only: widen the printed price into a ±N% range so we
   *  aren't held to a figure the factory hasn't confirmed. 0 = exact number. */
  priceRangePct?: number;
  /** Off-catalog sizes only: the "this is an estimate" line. */
  estimateNote?: string;
}

export function buildQuoteMessage(params: QuoteMessageParams): string {
  const {
    dimensions,
    hasHandles,
    hasLamination,
    quantity,
    logoColors,
    pricePerUnit,
    moldsIls = 0,
    currency,
    appUrl,
    alt: altRaw,
    showAlternative = true,
    bookingUrl = "https://calendly.com/elishosh687/30min",
    priceRangePct = 0,
    estimateNote = "",
  } = params;
  // Settings can suppress the alternative-shipping block; the caller still
  // passes it so the DB/quote log keeps the full picture.
  const alt = showAlternative ? altRaw : undefined;

  const fp = (n: number) => formatPrice(n, currency);
  // Show a total that equals the rounded per-unit × qty (not the precise
  // per-unit × qty), so the customer's own arithmetic reconciles.
  const molds = moldsIls > 0 ? moldsIls : 0;
  const totalShown = customerRoundedTotalIls(pricePerUnit, quantity, molds);
  // The plates are ordered once; the shipping choice doesn't change them.
  const altTotalShown = alt ? customerRoundedTotalIls(alt.pricePerUnit, quantity, molds) : 0;
  const savings = alt && altTotalShown < totalShown ? totalShown - altTotalShown : 0;

  // A range reads as an estimate; an exact number reads as a commitment. Which
  // one a custom size gets is a settings decision, not a code decision.
  const band = (n: number) =>
    priceRangePct > 0
      ? `${fp(n * (1 - priceRangePct / 100))}–${fp(n * (1 + priceRangePct / 100))}`
      : fp(n);

  const handlesText = hasHandles ? "עם ידיות" : "ללא ידיות";
  // Renders what was PRICED. The 3-colour rule is applied by the caller via
  // resolveLamination() — deriving it again here is what let the text and
  // the price disagree. See lib/factory/calculator/lamination.ts.
  const laminationText = hasLamination ? "עם למינציה" : "ללא למינציה";
  const altBlock = alt
    ? `\n💡 חלופה — משלוח ${alt.shippingName} (~${alt.shippingDays} ימים):\n` +
      `   ליחידה: ${band(alt.pricePerUnit)} | סה״כ: ${band(altTotalShown)}\n` +
      (savings > 0 ? `   חיסכון פוטנציאלי: ${fp(savings)}\n` : "")
    : "";

  return (
    `✅ הצעת מחיר:\n` +
    `שקית ${dimensions} ס״מ\n` +
    `ידיות: ${handlesText}\n` +
    `למינציה: ${laminationText}\n` +
    `כמות: ${quantity.toLocaleString()} | ${logoColors} צבעי הדפסה\n` +
    `משלוח: ימי (60–90 ימים מאישור הגרפיקה הסופית)\n` +
    (molds > 0 ? `🧩 גלופה חד-פעמית לעיצוב: ${fp(molds)}\n` : "") +
    `💰 ליחידה: ${band(pricePerUnit)} | סה״כ: ${band(totalShown)}\n` +
    altBlock +
    `\nכלול במחיר:\n` +
    `✓ עזרה בהתאמת המפרט לצורך ולתקציב\n` +
    `✓ הכנת קובץ הדפסה מלוגו קיים\n` +
    `✓ הדמיה ופריסה לאישור\n` +
    `✓ תיקונים עד לאישור לפני תחילת הייצור\n\n` +
    `צריכים מהר יותר? אפשר לבדוק מסלול אווירי או משולב מול נציג.\n` +
    `המחיר לא כולל מעמ\n` +
    `* ההצעה כפופה לאישור הסופי של החברה שלנו\n` +
    (estimateNote ? `${estimateNote}\n` : "") +
    `\n---\n` +
    (bookingUrl
      ? `מעדיפים שיחה? אפשר לקבוע כאן:\n${bookingUrl}\n\n`
      : "") +
    `אלבדי – אריזה ממותגת לסביבה שלך\n` +
    `דף הבית: ${appUrl}`
  );
}
