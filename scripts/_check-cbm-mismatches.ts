import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { desc, isNotNull } from "drizzle-orm";

async function main() {
  const rows = await db
    .select({
      id: factoryQuoteRequests.id,
      quotationNo: factoryQuoteRequests.quotationNo,
      feishuRowIndex: factoryQuoteRequests.feishuRowIndex,
      updatedAt: factoryQuoteRequests.updatedAt,
      fr: factoryQuoteRequests.factoryResponse,
    })
    .from(factoryQuoteRequests)
    .where(isNotNull(factoryQuoteRequests.factoryResponse))
    .orderBy(desc(factoryQuoteRequests.updatedAt))
    .limit(30);

  let warnCount = 0;
  for (const r of rows) {
    const fr = r.fr as any;
    const L = fr?.cartonLengthCm,
      W = fr?.cartonWidthCm,
      H = fr?.cartonHeightCm;
    const cbm = fr?.cartonCbm;
    const dimsCbm = L && W && H ? (L * W * H) / 1e6 : null;
    const warn =
      dimsCbm != null && cbm != null && dimsCbm > 0 && Math.abs(cbm - dimsCbm) / dimsCbm > 0.25;
    if (warn) warnCount++;
    console.log(
      `${warn ? "⚠️" : "  "} ${r.quotationNo ?? "-"} row=${r.feishuRowIndex ?? "-"} L×W×H=${L}×${W}×${H} cbm=${cbm} vs dims=${dimsCbm?.toFixed(3) ?? "-"}   [${r.updatedAt?.toISOString()?.slice(0, 10)}]`
    );
  }
  console.log(`\n${warnCount}/${rows.length} rows flagged`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
