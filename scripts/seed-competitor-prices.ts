/**
 * Seed the competitor price survey Eli ran (Aug 2026) into `competitor_prices`.
 *
 * Five competitors, 14 quotes, all 80GSM vest-handle non-woven bags. Grouped by
 * SIZE, because that is the only grouping where the numbers are comparable —
 * and it puts the story on one card: the same Print-Tek 30×40 bag is ₪6.45
 * made in Israel and ₪2.49 made in China.
 *
 * Our own side is left null on purpose. Eli logged what the competitors quote;
 * the screen was built to accept a sighting before we pin our own number.
 *
 * Lead time: `leadTimeText` holds what they actually said ("60-90 ימים"),
 * `competitorLeadDays` holds the UPPER bound so the numeric comparison is the
 * date a customer can rely on, never the optimistic end of a range.
 *
 * Idempotent: skips a row when the same competitor + size + quantity + ORIGIN
 * already exists. Origin belongs in that key — קרח הארץ quotes the same
 * 23×6×36 at 5,000 units from BOTH Israel (₪4.70) and China (₪1.95), and a key
 * without it silently swallowed the second quote on the first run.
 *
 *   DATABASE_URL="$(…neonctl connection-string …)" npx tsx scripts/seed-competitor-prices.ts
 *   …                                                                        --go
 */
import { db } from "../lib/db";
import { competitorPrices } from "../drizzle/schema";
import { and, eq } from "drizzle-orm";

const GO = process.argv.includes("--go");

interface Quote {
  competitor: string;
  origin: "ישראל" | "סין";
  size: string;
  quantity: number;
  price: number;
  plateFee: number | null;
  plateCurrency: "ILS" | "USD";
  leadText: string;
  leadDays: number;
  shippingIncluded: boolean;
  handles: string;
  notes?: string;
}

const QUOTES: Quote[] = [
  // ── פרינט טק ─────────────────────────────────────────────── 30×40
  { competitor: "פרינט טק", origin: "ישראל", size: "30×40", quantity: 1000, price: 7.68, plateFee: 240, plateCurrency: "ILS", leadText: "כשבועיים", leadDays: 14, shippingIncluded: false, handles: "גופיה" },
  { competitor: "פרינט טק", origin: "ישראל", size: "30×40", quantity: 3000, price: 7.19, plateFee: 240, plateCurrency: "ILS", leadText: "כשבועיים", leadDays: 14, shippingIncluded: false, handles: "גופיה" },
  { competitor: "פרינט טק", origin: "ישראל", size: "30×40", quantity: 5000, price: 6.45, plateFee: 240, plateCurrency: "ILS", leadText: "כשבועיים", leadDays: 14, shippingIncluded: false, handles: "גופיה" },
  { competitor: "פרינט טק", origin: "סין", size: "30×40", quantity: 10000, price: 2.49, plateFee: 540, plateCurrency: "ILS", leadText: "120 יום", leadDays: 120, shippingIncluded: true, handles: "גופיה" },

  // ── קרח הארץ ─────────────────────────────────────────────── 23×6×36
  { competitor: "קרח הארץ", origin: "ישראל", size: "23×6×36", quantity: 5000, price: 4.7, plateFee: 150, plateCurrency: "ILS", leadText: "שבועיים", leadDays: 14, shippingIncluded: false, handles: "גופיה" },
  { competitor: "קרח הארץ", origin: "סין", size: "23×6×36", quantity: 5000, price: 1.95, plateFee: 150, plateCurrency: "USD", leadText: "עד 90 ימים", leadDays: 90, shippingIncluded: true, handles: "גופיה", notes: "עלות הגלופה נמסרה בדולר — 150$." },

  // ── חביב אריזות ──────────────────────────────────────────── 30×10×30
  { competitor: "חביב אריזות", origin: "סין", size: "30×10×30", quantity: 1000, price: 2.5, plateFee: 0, plateCurrency: "ILS", leadText: "60-90 ימים", leadDays: 90, shippingIncluded: true, handles: "גופיה (תפירת בד)" },
  { competitor: "חביב אריזות", origin: "סין", size: "30×10×30", quantity: 3000, price: 2.2, plateFee: 0, plateCurrency: "ILS", leadText: "60-90 ימים", leadDays: 90, shippingIncluded: true, handles: "גופיה (תפירת בד)" },
  { competitor: "חביב אריזות", origin: "סין", size: "30×10×30", quantity: 5000, price: 2.0, plateFee: 0, plateCurrency: "ILS", leadText: "60-90 ימים", leadDays: 90, shippingIncluded: true, handles: "גופיה (תפירת בד)" },
  { competitor: "חביב אריזות", origin: "סין", size: "30×10×30", quantity: 10000, price: 1.9, plateFee: 0, plateCurrency: "ILS", leadText: "60-90 ימים", leadDays: 90, shippingIncluded: true, handles: "גופיה (תפירת בד)" },

  // ── גרין פק ──────────────────────────────────────────────── 26×36
  { competitor: "גרין פק", origin: "ישראל", size: "26×36", quantity: 1000, price: 5.95, plateFee: null, plateCurrency: "ILS", leadText: "שבועיים", leadDays: 14, shippingIncluded: false, handles: "גופיה", notes: "תיק אלבד ללא דופן, כולל הדפסה צבע אחד משני הצדדים." },
  { competitor: "גרין פק", origin: "ישראל", size: "26×36", quantity: 3000, price: 5.6, plateFee: null, plateCurrency: "ILS", leadText: "שבועיים", leadDays: 14, shippingIncluded: false, handles: "גופיה", notes: "תיק אלבד ללא דופן, כולל הדפסה צבע אחד משני הצדדים." },
  { competitor: "גרין פק", origin: "ישראל", size: "26×36", quantity: 5000, price: 5.4, plateFee: null, plateCurrency: "ILS", leadText: "שבועיים", leadDays: 14, shippingIncluded: false, handles: "גופיה", notes: "תיק אלבד ללא דופן, כולל הדפסה צבע אחד משני הצדדים." },

  // ── גאלרי באג ────────────────────────────────────────────── 30×40
  { competitor: "גאלרי באג", origin: "סין", size: "30×40", quantity: 5000, price: 1.2, plateFee: 500, plateCurrency: "ILS", leadText: "100 יום", leadDays: 100, shippingIncluded: true, handles: "גופיה", notes: "גלופה ₪500 לצבע." },
];

const productOf = (q: Quote) => `שקית אל-בד ${q.size}`;

async function main() {
  console.log(
    GO ? "=== מכניס ===\n" : "=== DRY RUN (הוסף --go כדי לכתוב) ===\n",
  );
  let added = 0;
  let skipped = 0;

  for (const q of QUOTES) {
    const product = productOf(q);
    const existing = await db
      .select({ id: competitorPrices.id })
      .from(competitorPrices)
      .where(
        and(
          eq(competitorPrices.competitor, q.competitor),
          eq(competitorPrices.size, q.size),
          eq(competitorPrices.quantity, q.quantity),
          eq(competitorPrices.origin, q.origin),
        ),
      )
      .limit(1);

    if (existing.length) {
      skipped++;
      console.log(`דילוג (קיים)  ${q.competitor.padEnd(14)} ${q.origin.padEnd(6)} ${q.size.padEnd(10)} ${q.quantity}`);
      continue;
    }

    const shipping = q.shippingIncluded ? "כולל משלוח" : "ללא משלוח";
    const line = `${q.competitor.padEnd(14)} ${q.origin.padEnd(6)} ${q.size.padEnd(10)} ${String(q.quantity).padStart(6)} × ₪${q.price.toFixed(2)}  ${shipping}`;

    if (!GO) {
      console.log(`יתווסף        ${line}`);
      added++;
      continue;
    }

    await db.insert(competitorPrices).values({
      product,
      competitor: q.competitor,
      quantity: q.quantity,
      size: q.size,
      handles: q.handles,
      logoColors: 1,
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
    console.log(`נוסף          ${line}`);
  }

  console.log(`\n${GO ? "נוספו" : "יתווספו"} ${added} · דילוג ${skipped}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
