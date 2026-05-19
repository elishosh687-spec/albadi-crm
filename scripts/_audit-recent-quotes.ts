/**
 * Audit recent bot quotes vs. Eli's target margin matrix.
 *   1000 → 200%, 3000 → 100%, 5000 → 75%, 10000 → 50%
 * Reads bot_quotes from the last N hours, recomputes the expected total
 * using the target margins, and prints a comparison table.
 */
import "dotenv/config";
import { db } from "../lib/db";
import { botQuotes, leads } from "../drizzle/schema";
import { and, gte, desc, eq } from "drizzle-orm";
import { calculateQuote } from "../lib/factory/calculator/engine";
import { DEFAULT_CONFIG } from "../lib/factory/calculator/constants";
import type { AppConfig, QuoteFormData } from "../lib/factory/calculator/types";
import { getFactoryConfig } from "../lib/factory/config";

const HOURS = Number(process.argv[2] ?? 14);

const TARGET_MARGIN: Record<string, number> = {
  "1000": 200,
  "3000": 100,
  "5000": 75,
  "10000": 50,
};

const QTY_BY_TIER: Record<string, number> = {
  q0: 1000, q1: 3000, q2: 5000, q3: 10000,
};

function snapDownMargin(qty: number): number {
  const keys = Object.keys(TARGET_MARGIN).map(Number).sort((a, b) => a - b);
  let best = keys[0];
  for (const k of keys) if (k <= qty) best = k;
  return TARGET_MARGIN[String(best)];
}

async function main() {
  const since = new Date(Date.now() - HOURS * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: botQuotes.id,
      leadSid: botQuotes.leadSid,
      source: botQuotes.source,
      qState: botQuotes.qState,
      quoteTotalIls: botQuotes.quoteTotalIls,
      quoteAltTotalIls: botQuotes.quoteAltTotalIls,
      sentAt: botQuotes.sentAt,
    })
    .from(botQuotes)
    .where(gte(botQuotes.sentAt, since))
    .orderBy(desc(botQuotes.sentAt));

  console.log(`\nFound ${rows.length} bot_quotes in last ${HOURS}h\n`);
  if (!rows.length) return;

  // Live admin config (rates may have drifted from DEFAULT_CONFIG)
  const dbCfg = await getFactoryConfig();

  // Build cfg with TARGET margins instead of admin matrix
  const baseCfg: AppConfig = {
    ...DEFAULT_CONFIG,
    exchangeRates: {
      usdToIls: dbCfg.usdToIls,
      usdToCny: dbCfg.usdToCny,
    },
    shippingOptions: DEFAULT_CONFIG.shippingOptions.map((s) => {
      const dbOpt = dbCfg.shippingOptions.find((d) => d.type === s.type && d.enabled);
      if (!dbOpt) return s;
      return {
        ...s,
        enabled: dbOpt.enabled,
        seaRate: dbOpt.seaRate ?? s.seaRate,
        airRates: dbOpt.airRates ?? s.airRates,
      };
    }),
  };

  const targetCfg: AppConfig = {
    ...baseCfg,
    adminSettings: {
      globalProfitMargin: 100,
      profitMarginByQuantity: { ...TARGET_MARGIN },
    },
  };

  // Also build current-DB-margin cfg for reference (what bot actually used)
  const dbMarginCfg: AppConfig = {
    ...baseCfg,
    adminSettings: {
      globalProfitMargin: dbCfg.defaultProfitMargin,
      profitMarginByQuantity: { ...(dbCfg.profitMarginByQuantity ?? {}) },
    },
  };

  for (const r of rows) {
    const sid = r.leadSid;
    const leadRow = await db
      .select({ name: leads.name, phone: leads.phoneE164 })
      .from(leads)
      .where(eq(leads.manychatSubId, sid))
      .limit(1);
    const lead = leadRow[0];
    const q = r.qState as any;
    const tierId = q?.quantity;
    const qtyCustom = q?.quantityCustom ? Number(q.quantityCustom) : null;
    const qty = qtyCustom ?? QTY_BY_TIER[tierId] ?? null;

    const form: QuoteFormData = {
      productId: q?.product,
      quantityTierId: tierId ?? null,
      quantityOverride: qtyCustom ?? null,
      hasHandles: q?.handles === "true" || q?.handles === true,
      logoColors: Number(q?.colors ?? 1) || 1,
      shippingOptionId: q?.shipping ?? "s2",
      selectedFeatureIds: q?.lamination === "true" || q?.lamination === true ? ["f1"] : [],
    };

    let expected: number | null = null;
    let bot: number | null = null;
    let usedMargin: number | null = null;
    try {
      const exp = calculateQuote(form, targetCfg);
      const dbq = calculateQuote(form, dbMarginCfg);
      expected = exp?.totalOrderPriceIls ?? null;
      bot = dbq?.totalOrderPriceIls ?? null;
      usedMargin = exp?.profitMargin ?? null;
    } catch (e: any) {
      // skip on malformed qState
    }

    const stored = r.quoteTotalIls ?? null;
    const targetMargin = qty ? snapDownMargin(qty) : null;
    const delta = stored !== null && expected !== null ? stored - expected : null;
    const deltaPct =
      stored !== null && expected !== null && expected > 0
        ? ((stored - expected) / expected) * 100
        : null;

    const flag =
      deltaPct === null
        ? "?"
        : Math.abs(deltaPct) < 1
          ? "OK"
          : deltaPct < 0
            ? "LOW"
            : "HIGH";

    console.log("─".repeat(90));
    console.log(
      `${flag.padEnd(5)} #${r.id} ${r.source.padEnd(7)} ${r.sentAt?.toISOString?.() ?? r.sentAt}`,
    );
    console.log(
      `  lead=${lead?.name ?? "?"} ${lead?.phone ?? sid}  product=${q?.product ?? "?"}  qty=${qty ?? "?"} ship=${q?.shipping ?? "?"} handles=${form.hasHandles} colors=${form.logoColors} lam=${form.selectedFeatureIds.includes("f1")}`,
    );
    console.log(
      `  stored=₪${stored?.toFixed?.(0) ?? "?"}  bot-recalc(currentDBmargin=${dbMarginCfg.adminSettings.profitMarginByQuantity[String(qty)] ?? dbCfg.defaultProfitMargin}%)=₪${bot?.toFixed?.(0) ?? "?"}  expected@target(${targetMargin}%)=₪${expected?.toFixed?.(0) ?? "?"}  Δ=${delta !== null ? (delta > 0 ? "+" : "") + delta.toFixed(0) : "?"} (${deltaPct !== null ? (deltaPct > 0 ? "+" : "") + deltaPct.toFixed(1) + "%" : "?"})`,
    );
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
