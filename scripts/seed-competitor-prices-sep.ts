/**
 * Eli's September 2026 round of competitor quotes (חביב · גאלרי באג).
 *
 * Both quote a MATRIX — a base price plus lamination and extra-colour variants
 * at two quantities — so each variant is its own row. That is the only way the
 * comparison stays honest: our side is priced against each row's actual spec
 * (see the lamination/handles handling in /api/widget/competitor-prices/our-side),
 * and a laminated quote compared against our plain bag would flatter us.
 *
 * Four competitors gave no price at all and are recorded as a note, not a row:
 * a row with no number would sit in the table pretending to be a comparison.
 *
 *   DATABASE_URL="$(…neonctl…)" npx tsx scripts/seed-competitor-prices-sep.ts
 *   …                                                                    --go
 */
import { db } from "../lib/db";
import { competitorPrices } from "../drizzle/schema";
import { and, eq, sql } from "drizzle-orm";

const GO = process.argv.includes("--go");

interface Quote {
  competitor: string;
  origin: "ישראל" | "סין";
  size: string;
  quantity: number;
  price: number;
  logoColors: number;
  lamination: "בלי" | "מבריקה";
  handles: string;
  plateFee: number | null;
  plateCurrency: "ILS" | "USD";
  leadText: string | null;
  leadDays: number | null;
  shippingIncluded: boolean | null;
  notes?: string;
}

// חביב: "ליח׳ + מע״מ, הובלה וגלופה" — ex-VAT like ours, and both shipping and
// the plate are already inside the per-unit price, so plateFee is 0 and not null.
const HAVIV_NOTE = "מחיר ליחידה + מע״מ, כולל הובלה וגלופה.";
const havivRows: Quote[] = [];
for (const [colors, lam, p5, p10] of [
  [1, "בלי", 1.6, 1.3],
  [1, "מבריקה", 2.1, 1.8],
  [2, "בלי", 1.9, 1.6],
  [2, "מבריקה", 2.4, 2.1],
] as [number, "בלי" | "מבריקה", number, number][]) {
  for (const [qty, price] of [[5000, p5], [10000, p10]] as [number, number][]) {
    havivRows.push({
      competitor: "חביב אריזות",
      origin: "סין",
      size: "40×13×50",
      quantity: qty,
      price,
      logoColors: colors,
      lamination: lam,
      handles: "גופיה",
      plateFee: 0,
      plateCurrency: "ILS",
      leadText: "60-90 ימים",
      leadDays: 90,
      shippingIncluded: true,
      notes: HAVIV_NOTE,
    });
  }
}
// "מחוזקת" is a heavier build we don't model as a field — recorded so the
// number isn't lost, flagged so nobody reads it as the same bag.
for (const [qty, price] of [[5000, 2.5], [10000, 2.4]] as [number, number][]) {
  havivRows.push({
    competitor: "חביב אריזות",
    origin: "סין",
    size: "40×13×50",
    quantity: qty,
    price,
    logoColors: 1,
    lamination: "בלי",
    handles: "גופיה מחוזקת",
    plateFee: 0,
    plateCurrency: "ILS",
    leadText: "60-90 ימים",
    leadDays: 90,
    shippingIncluded: true,
    notes: HAVIV_NOTE + " גרסה מחוזקת — בנייה כבדה יותר, לא אותו מפרט כמו שאר השורות.",
  });
}

// גאלרי באג: ex-VAT (Eli confirmed 02/09) — the same basis as ours, so the
// gap below is a real one and not a 15% artefact. The extra colour is a ₪500
// LUMP, i.e. a plate fee, not a per-unit uplift.
const GALLERY_NOTE =
  'המחיר לפני מע״מ — אלי אישר 02/09/2026, אותו בסיס כמו שלנו. "שחור-לבן" = הדפסה בצבע אחד (אלי אישר 02/09). צבע נוסף: ₪500 סכום חד-פעמי לצבע.';
const galleryRows: Quote[] = [];
for (const [lam, p5, p10] of [
  ["בלי", 1.4, 1.2],
  ["מבריקה", 1.55, 1.35],
] as ["בלי" | "מבריקה", number, number][]) {
  for (const [qty, price] of [[5000, p5], [10000, p10]] as [number, number][]) {
    galleryRows.push({
      competitor: "גאלרי באג",
      origin: "סין",
      size: "30×10×40",
      quantity: qty,
      price,
      logoColors: 1,
      lamination: lam,
      handles: "גופיה",
      plateFee: 500,
      plateCurrency: "ILS",
      leadText: null,
      leadDays: null,
      shippingIncluded: null,
      notes: GALLERY_NOTE,
    });
  }
}

const QUOTES = [...havivRows, ...galleryRows];

async function main() {
  console.log(GO ? "=== מכניס ===\n" : "=== DRY RUN (הוסף --go) ===\n");
  let added = 0;
  let skipped = 0;

  for (const q of QUOTES) {
    const product = `שקית אל-בד ${q.size}`;
    // Dedupe key carries the whole spec: the same competitor quotes the same
    // size and quantity several times over, differing only by colours and
    // lamination, so a narrower key would swallow most of the matrix.
    const existing = await db
      .select({ id: competitorPrices.id })
      .from(competitorPrices)
      .where(
        and(
          eq(competitorPrices.competitor, q.competitor),
          eq(competitorPrices.size, q.size),
          eq(competitorPrices.quantity, q.quantity),
          eq(competitorPrices.logoColors, q.logoColors),
          sql`coalesce(${competitorPrices.lamination}, '') = ${q.lamination}`,
          sql`coalesce(${competitorPrices.handles}, '') = ${q.handles}`
        )
      )
      .limit(1);

    const line = `${q.competitor.padEnd(13)} ${q.size.padEnd(10)} ${String(q.quantity).padStart(6)} · ${q.logoColors}צ · ${q.lamination === "בלי" ? "ללא למינציה" : "למינציה   "} → ₪${q.price.toFixed(2)}`;
    if (existing.length) {
      skipped++;
      console.log(`דילוג  ${line}`);
      continue;
    }
    if (!GO) {
      added++;
      console.log(`יתווסף ${line}`);
      continue;
    }
    await db.insert(competitorPrices).values({
      product,
      competitor: q.competitor,
      quantity: q.quantity,
      size: q.size,
      handles: q.handles,
      logoColors: q.logoColors,
      lamination: q.lamination,
      gsm: 80,
      origin: q.origin,
      shippingIncluded: q.shippingIncluded,
      leadTimeText: q.leadText,
      competitorPrice: q.price,
      competitorLeadDays: q.leadDays,
      competitorPlateFee: q.plateFee,
      competitorPlateFeeCurrency: q.plateCurrency,
      notes: q.notes ?? null,
    });
    added++;
    console.log(`נוסף   ${line}`);
  }
  console.log(`\n${GO ? "נוספו" : "יתווספו"} ${added} · דילוג ${skipped}`);
  console.log("ללא מחיר (לא נכנסו כשורות): פולי · תיקו (ביקשו שיחה) · עדן · זאב");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
