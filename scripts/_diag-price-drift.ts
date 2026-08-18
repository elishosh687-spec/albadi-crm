/**
 * Did the two יוסי גולד quotes' stored prices change under us? Print current
 * pricing + row timestamps.
 *   DATABASE_URL="$(...)" npx tsx scripts/_diag-price-drift.ts
 */
import { db } from "@/lib/db";
import { factoryQuoteRequests, leads } from "@/drizzle/schema";
import { and, isNull, sql } from "drizzle-orm";
import { getFactoryConfig } from "@/lib/factory/config";
import type { FactoryPricingResult } from "@/lib/factory/types";

async function main() {
  const rows = await db
    .select({
      id: factoryQuoteRequests.id,
      q: factoryQuoteRequests.quotationNo,
      fp: factoryQuoteRequests.finalPricing,
      updatedAt: factoryQuoteRequests.updatedAt,
      createdAt: factoryQuoteRequests.createdAt,
      sentAt: factoryQuoteRequests.sentToCustomerAt,
    })
    .from(factoryQuoteRequests)
    .innerJoin(leads, sql`trim(${leads.manychatSubId}) = trim(${factoryQuoteRequests.manychatSubId})`)
    .where(and(isNull(factoryQuoteRequests.deletedAt), sql`${leads.name} = 'יוסי גולד בייבי'`));

  for (const r of rows) {
    const fp = r.fp as FactoryPricingResult;
    console.log(`${r.q} (${r.id})`);
    console.log(`   unit ₪${fp?.unitSellingPrice} × ${fp?.quantity} · shipping=${fp?.shippingOptionId} (${fp?.shippingOptionName}) · CBM ${fp?.totalCbm} · משקל ${fp?.totalWeightKg}kg`);
    console.log(`   totalSellingPrice ₪${fp?.totalSellingPrice} · totalShipping ₪${fp?.totalShipping}`);
    console.log(`   נוצר ${r.createdAt?.toISOString()} · עודכן ${r.updatedAt?.toISOString()} · נשלח ${r.sentAt?.toISOString() ?? "—"}`);
  }

  const cfg = await getFactoryConfig();
  console.log(`\nFX: usdToIls=${cfg.usdToIls} usdToCny=${cfg.usdToCny} fxUpdatedAt=${cfg.fxUpdatedAt ?? "—"}`);
  console.log(`assumedShipmentCbm=${cfg.assumedShipmentCbm} activeSeaCarrier=${cfg.activeSeaCarrierId}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
