/**
 * "What should the customer bring to the call?" — computed, not guessed.
 *
 * Eli's actual complaint: he calls leads who have no dimensions and no logo,
 * so there is nothing to discuss and the call is wasted. The fix isn't a
 * generic "prepare details" line — it's telling THIS customer exactly what
 * THEY are missing, so the scheduled call starts with everything on the table.
 *
 * DETERMINISTIC on purpose. Every item below is something the DB already
 * knows (questionnaire state, quote history, factory requests), and the
 * project rule is: never let the LLM guess a fact the DB has. The LLM only
 * phrases the surrounding message.
 */
import { db } from "../db";
import { leads, factoryQuoteRequests } from "../../drizzle/schema";
import { sql } from "drizzle-orm";
import type { QState } from "./questionnaire";

export type PrepItem = "size" | "size_confirm" | "logo" | "quantity" | "usage";

export interface CallPrep {
  /** Items the customer still needs to bring. Empty = they're ready. */
  missing: PrepItem[];
  /** Ready-to-send Hebrew bullet list, or null when nothing is missing. */
  text: string | null;
}

const PREP_LABELS: Record<PrepItem, string> = {
  size: "מידות השקית (גובה × עומק × רוחב בס״מ) — או דוגמה של שקית שאתם אוהבים",
  size_confirm:
    "אישור מידות סופיות — נבחרה מידה מהקטלוג; כדאי למדוד ולוודא שזו בדיוק המידה שצריך",
  logo: "קובץ הלוגו (רצוי וקטורי — AI / EPS / PDF)",
  quantity: "כמה יחידות אתם צריכים",
  usage: "למה השקית משמשת (מוצר, אירוע, חנות)",
};

function parseQ(raw: unknown): QState | null {
  if (!raw) return null;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as QState;
    } catch {
      return null;
    }
  }
  return raw as QState;
}

/**
 * Work out what this lead is still missing for a productive sales call.
 *
 * Reads the questionnaire answers first (the fastest signal), then falls back
 * to any factory quote request — a lead that already has a priced request has
 * a spec, whatever the questionnaire says.
 */
export async function computeCallPrep(sid: string): Promise<CallPrep> {
  const [row] = await db
    .select({ qState: leads.qState })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${sid.trim()}`)
    .limit(1);

  const q = parseQ(row?.qState);

  // A factory request means a real spec exists (size + quantity at minimum).
  const [req] = await db
    .select({ productSpec: factoryQuoteRequests.productSpec })
    .from(factoryQuoteRequests)
    .where(sql`trim(${factoryQuoteRequests.manychatSubId}) = ${sid.trim()}`)
    .limit(1);
  const spec = (req?.productSpec ?? null) as Record<string, unknown> | null;

  const missing: PrepItem[] = [];

  // Three levels of "has a size":
  //  - a factory-request spec or customer-typed dims = real, exact dimensions;
  //  - a catalog pick = a price anchor, NOT a commitment (Eli, 14.8: customers
  //    pick a catalog size to see prices — the exact size still needs
  //    confirming before production, and that's a call topic);
  //  - nothing = missing entirely.
  const hasExactSize =
    !!q?.productCustom || !!(spec?.size && String(spec.size).trim());
  const hasCatalogPick = !!q?.product && q.product !== "custom";
  if (!hasExactSize) {
    missing.push(hasCatalogPick ? "size_confirm" : "size");
  }

  const hasQuantity =
    !!q?.quantity || !!q?.quantityCustom || Number(spec?.quantity ?? 0) > 0;
  if (!hasQuantity) missing.push("quantity");

  // The logo only ever arrives as an inbound file, which moves the lead into
  // the awaiting_factory_estimate sub-flow. Anything earlier means no logo yet.
  // subFlow is written into q_state as a loose jsonb key, not a QState field.
  const subFlow = (q as Record<string, unknown> | null)?.subFlow;
  const hasLogo = subFlow === "awaiting_factory_estimate";
  if (!hasLogo) missing.push("logo");

  if (missing.length === 0) return { missing, text: null };

  const text = missing.map((m) => `• ${PREP_LABELS[m]}`).join("\n");
  return { missing, text };
}

/** Same list, phrased for the salesperson's task rather than the customer. */
export function prepForSalesperson(prep: CallPrep): string {
  if (prep.missing.length === 0) return "יש מפרט מלא — אפשר לתמחר בשיחה.";
  const short: Record<PrepItem, string> = {
    size: "מידות",
    size_confirm: "אישור מידות סופיות",
    logo: "לוגו",
    quantity: "כמות",
    usage: "שימוש",
  };
  return `חסר ללקוח: ${prep.missing.map((m) => short[m]).join(", ")}`;
}
