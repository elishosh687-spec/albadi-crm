/**
 * Fill OUR side of the competitor comparison, and record where each number came
 * from — the exact catalog calculator or the estimator model.
 *
 * It calls the SAME HTTP endpoints the widget calls rather than re-deriving the
 * pricing: /api/factory/quote-preview for a catalog SKU, /api/factory/estimate
 * for a size we don't stock. Re-implementing either would drift from what Eli
 * sees on screen, and the engine has real subtleties (colours and handles are
 * already baked into the estimator's unit cost — passing them again charges
 * twice) that only live inside those routes.
 *
 * Point it at the local dev server started from the `albadi-crm-data-dev`
 * launch config: blank GHL_WIDGET_TOKEN takes verifyWidgetToken's dev
 * pass-through, and DATABASE_URL is the live DB, so margins, FX and sea-carrier
 * rates are production's.
 *
 * Which source per size:
 *   30×40      → catalog p5 (H30 D0 W40)   → exact calculator
 *   30×10×30   → catalog p2 (H30 D10 W30)  → exact calculator
 *   23×6×36    → no catalog SKU            → estimator
 *   26×36      → no catalog SKU            → estimator
 *
 * Sea shipping throughout: every competitor here quotes either local Israeli
 * production or sea from China, so air would not be comparable.
 *
 *   BASE=http://localhost:3002 DATABASE_URL="$(…)" npx tsx scripts/price-our-side-competitors.ts
 *   …                                                                              --go
 */
import { db } from "../lib/db";
import { competitorPrices } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { matchCatalogProduct } from "../lib/factory/catalog-dims";

const GO = process.argv.includes("--go");
const BASE = process.env.BASE ?? "http://localhost:3002";
// middleware gates /api/factory/* — the dev launch config sets this token.
const TOKEN = process.env.WIDGET_TOKEN ?? "devlocal";
const SHIPPING = "sea-standard";

const SPECS: { size: string; h: number; d: number; w: number }[] = [
  { size: "30×40", h: 30, d: 0, w: 40 },
  { size: "23×6×36", h: 23, d: 6, w: 36 },
  { size: "30×10×30", h: 30, d: 10, w: 30 },
  { size: "26×36", h: 26, d: 0, w: 36 },
];

interface Priced {
  unitIls: number;
  leadDays: number | null;
  source: "calculator" | "estimator";
  note?: string;
}

async function get(path: string): Promise<any> {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${res.status} non-JSON: ${text.slice(0, 120)}`);
  }
  if (!res.ok) throw new Error(`${res.status} ${json?.error ?? ""} ${json?.detail ?? ""}`);
  return json;
}

async function priceExact(productId: string, qty: number, colors: number): Promise<Priced> {
  const q = new URLSearchParams({
    product: productId,
    qty: "",
    qtyOverride: String(qty),
    shipping: SHIPPING,
    handles: "true",
    lamination: "false",
    colors: String(colors),
    widget_token: TOKEN,
  });
  const j = await get(`/api/factory/quote-preview?${q}`);
  const r = j.result;
  if (!r) throw new Error("no result");
  return {
    unitIls: r.pricePerUnitIls,
    leadDays: r.shippingOption?.leadTimeDays ?? null,
    source: "calculator",
  };
}

async function priceEstimate(
  spec: { h: number; d: number; w: number },
  qty: number,
  colors: number,
): Promise<Priced> {
  const q = new URLSearchParams({
    widthCm: String(spec.w),
    heightCm: String(spec.h),
    depthCm: String(spec.d),
    qty: String(qty),
    shipping: SHIPPING,
    handles: "true",
    lamination: "false",
    colors: String(colors),
    widget_token: TOKEN,
  });
  const j = await get(`/api/factory/estimate?${q}`);
  if (!j.result) {
    throw new Error(j.estimate?.refused ?? "estimator refused");
  }
  const r = j.result;
  return {
    unitIls: r.pricePerUnitIls,
    leadDays: r.shippingOption?.leadTimeDays ?? null,
    source: "estimator",
    note: j.estimate?.confidence ? `ביטחון: ${j.estimate.confidence}` : undefined,
  };
}

async function main() {
  console.log(`${GO ? "=== מעדכן ===" : "=== DRY RUN (הוסף --go) ==="}   דרך ${BASE}\n`);

  const rows = await db.select().from(competitorPrices);
  const mine = rows
    .filter((r) => SPECS.some((s) => s.size === r.size))
    .sort((a, b) => (a.size ?? "").localeCompare(b.size ?? "") || (a.quantity ?? 0) - (b.quantity ?? 0));

  let done = 0;
  let failed = 0;

  for (const row of mine) {
    const spec = SPECS.find((s) => s.size === row.size)!;
    const qty = row.quantity ?? 5000;
    const colors = row.logoColors ?? 1;
    const catalog = matchCatalogProduct(spec.h, spec.d, spec.w);

    let priced: Priced | null = null;
    try {
      priced = catalog
        ? await priceExact(catalog.id, qty, colors)
        : await priceEstimate(spec, qty, colors);
    } catch (e) {
      failed++;
      console.log(`✗ ${String(row.size).padEnd(10)} ${String(qty).padStart(6)}  ${(e as Error).message}`);
      continue;
    }

    const label = priced.source === "calculator" ? "מדויק" : "משוער";
    const theirs = row.competitorPrice;
    const verdict =
      theirs == null
        ? ""
        : priced.unitIls < theirs
          ? `  ← אנחנו זולים ב-₪${(theirs - priced.unitIls).toFixed(2)}`
          : `  ← הם זולים ב-₪${(priced.unitIls - theirs).toFixed(2)}`;
    console.log(
      `${GO ? "✓" : "·"} ${String(row.size).padEnd(10)} ${String(qty).padStart(6)}  ${label}  אנחנו ₪${priced.unitIls.toFixed(2)}  ${String(row.competitor).padEnd(12)} ₪${theirs}${verdict}`,
    );

    if (GO) {
      await db
        .update(competitorPrices)
        .set({
          ourPrice: priced.unitIls,
          ourLeadDays: priced.leadDays,
          ourPriceSource: priced.source,
        })
        .where(eq(competitorPrices.id, row.id));
    }
    done++;
  }

  console.log(`\n${GO ? "עודכנו" : "יעודכנו"} ${done} · נכשלו ${failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
