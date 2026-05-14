/**
 * Hebrew quote message template — ported from
 * bag-quote-app/lib/i18n/manychat-messages.ts (Hebrew branch only) +
 * formatPrice from lib/i18n/currency.ts.
 *
 * Used by the bot in lib/autoresponder/questionnaire.ts after the local
 * calculator returns the result.
 */

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
  currency: string;
  appUrl: string;
  alt?: {
    shippingName: string;
    shippingDays: number | string;
    pricePerUnit: number;
    totalOrder: number;
  } | null;
}

export function buildQuoteMessage(params: QuoteMessageParams): string {
  const {
    dimensions,
    hasHandles,
    hasLamination,
    quantity,
    logoColors,
    shippingName,
    shippingDays,
    pricePerUnit,
    totalOrder,
    currency,
    appUrl,
    alt,
  } = params;

  const fp = (n: number) => formatPrice(n, currency);
  const savings = alt && alt.totalOrder < totalOrder ? totalOrder - alt.totalOrder : 0;

  const handlesText = hasHandles ? "עם ידיות" : "ללא ידיות";
  const laminationText = hasLamination ? "עם למינציה" : "ללא למינציה";
  const altBlock = alt
    ? `\n💡 חלופה — משלוח ${alt.shippingName} (~${alt.shippingDays} ימים):\n` +
      `   ליחידה: ${fp(alt.pricePerUnit)} | סה״כ: ${fp(alt.totalOrder)}\n` +
      (savings > 0 ? `   חיסכון פוטנציאלי: ${fp(savings)}\n` : "")
    : "";

  return (
    `✅ הצעת מחיר:\n` +
    `שקית ${dimensions} ס״מ\n` +
    `ידיות: ${handlesText}\n` +
    `למינציה: ${laminationText}\n` +
    `כמות: ${quantity.toLocaleString()} | ${logoColors} צבעי הדפסה\n` +
    `משלוח: ${shippingName} (~${shippingDays} ימים)\n` +
    `💰 ליחידה: ${fp(pricePerUnit)} | סה״כ: ${fp(totalOrder)}\n` +
    altBlock +
    `המחיר לא כולל מעמ\n` +
    `* ההצעה כפופה לאישור הסופי של החברה שלנו\n` +
    `\n---\n` +
    `קבע שיחה קצרה – נסביר הכל ב־10 דקות\n` +
    `https://calendly.com/elishosh687/30min\n\n` +
    `אלבדי – אריזה ממותגת לסביבה שלך\n` +
    `דף הבית: ${appUrl}`
  );
}
