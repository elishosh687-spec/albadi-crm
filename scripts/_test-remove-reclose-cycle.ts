/**
 * Rehearse exactly what Eli is about to do by hand: remove the combined deal,
 * then close it again — and assert the frozen combined offer comes back correct.
 *
 * Also covers the trap: re-closing only ONE of the members must NOT keep pricing
 * the deal off the old combined snapshot.
 *
 *   DATABASE_URL="$(...)" npx tsx scripts/_test-remove-reclose-cycle.ts
 */
import { listClosedQuotes, removeDeal, closeDealGroup, setDealClosed } from "@/lib/factory/server/closed";

const ils = (n: number | undefined) => `₪${(n ?? 0).toLocaleString("he-IL", { maximumFractionDigits: 2 })}`;

async function show(label: string, ids: string[]) {
  const deals = await listClosedQuotes();
  const hit = deals.filter((d) => d.products.some((p) => ids.includes(p.id)));
  console.log(`\n— ${label}`);
  if (hit.length === 0) { console.log("   (לא מופיע בעסקאות)"); return deals; }
  for (const d of hit) {
    console.log(
      `   ${d.customerName} ${d.isCombined ? "[משולבת]" : "[יחידה]"} · סה״כ ${ils(d.grandTotalExVat)}` +
        ` · snapshot ${d.combinedPricing ? ils(d.combinedPricing.grandTotalIls) : "—"}`
    );
    for (const p of d.products) {
      console.log(`     ${p.quotationNo}: ${p.finalPricing?.quantity} × ₪${p.finalPricing?.unitSellingPrice}`);
    }
    if (d.paymentSchedule) console.log(`     תשלומים על ${ils(d.paymentSchedule.subtotal)}`);
  }
  return deals;
}

async function main() {
  const before = await listClosedQuotes();
  const combined = before.find((d) => d.isCombined && d.products.length > 1);
  if (!combined) { console.log("אין עסקה משולבת לבדיקה"); return; }
  const ids = combined.products.map((p) => p.id);
  console.log(`בודק על: ${combined.customerName} · ${ids.length} מוצרים`);
  await show("מצב התחלתי", ids);

  console.log("\n>>> הסר מעסקאות");
  await removeDeal(combined.id);
  await show("אחרי הסרה", ids);

  console.log("\n>>> סגור מחדש רק מוצר אחד (המלכודת)");
  await setDealClosed(ids[0], true);
  await show("עסקה יחידה — לא אמורה להשתמש ב-snapshot הישן", ids);
  await setDealClosed(ids[0], false);

  console.log("\n>>> סגור עסקה משולבת מחדש");
  await closeDealGroup(ids);
  const after = await show("אחרי סגירה מחדש", ids);

  const finalDeal = after.find((d) => d.products.some((p) => ids.includes(p.id)));
  const ok =
    finalDeal?.isCombined &&
    finalDeal.combinedPricing != null &&
    Math.abs((finalDeal.grandTotalExVat ?? 0) - (combined.grandTotalExVat ?? 0)) < 0.01;
  console.log(`\n${ok ? "✅" : "❌"} חזר למצב הנכון: ${ils(finalDeal?.grandTotalExVat)} (היה ${ils(combined.grandTotalExVat)})`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
