import { buildSalesContext } from "../lib/setter/context";
import { validateMessage } from "../lib/setter/generate";
import { proposeCallSlots } from "../lib/setter/slots";
import type { SalesStrategy } from "../lib/setter/strategy";

const strat = { goal: "book_call", moves: [], avoid: [], skills: [], informationToRequest: [] } as unknown as SalesStrategy;

(async () => {
  for (const sid of ["972502348255@c.us", "972545521186@c.us"]) {
    const ctx = await buildSalesContext(sid);
    console.log(`\n${sid} — ${ctx?.name}`);
    console.log("   quote:", JSON.stringify(ctx?.quote));
  }

  const ctx = (await buildSalesContext("972502348255@c.us"))!;
  const now = new Date("2026-09-01T16:20:00Z"); // 19:20 IL
  const slots = await proposeCallSlots(ctx.sid, now);
  
  console.log("\nחלונות מותרים:", slots.map(s=>s.label).join(" | "));

  const cases = [
    "בתאל, בהצעה של ₪2,610 נשאר רק לאשר את מידת הקטלוג ולהציץ בלוגו. אפשר שיחה קצרה של 10 דקות מחר ב־11:00?",
    "בתאל, נשאר רק לאשר את מידת הקטלוג ולהציץ בלוגו. אפשר שיחה של 10 דקות היום ב-17:00?",
    `בתאל, נשאר רק לאשר את מידת הקטלוג ולהציץ בלוגו. אפשר שיחה קצרה ${slots[0]?.label}?`,
    `בתאל, נשאר רק לאשר את המידה. מתאים לך ${slots[0]?.label} או ${slots[1]?.label}?`,
    `בתאל, נשאר רק לאשר את המידה. מתאים לך ${slots[0]?.label.replace("ב-", "ב־")}?`,
  ];
  for (const c of cases) {
    const v = validateMessage(c, ctx, strat, 60, slots);
    console.log(`\n${v.ok ? "✅ עובר" : "❌ נפסל"}: ${c}`);
    if (!v.ok) console.log("   " + v.violations.join(" | "));
  }
})().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1)});
