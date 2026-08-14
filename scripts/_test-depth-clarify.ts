process.env.BRIDGE_DRY_RUN = "1";
import { db } from "../lib/db";
import { leads } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function walk(steps: string[], label: string) {
  const { resetPlayground } = await import("../lib/bot-playground/session");
  const { handleInbound } = await import("../lib/autoresponder/questionnaire");
  await resetPlayground();
  console.log(`\n===== ${label} =====`);
  for (const t of steps) {
    const r = await handleInbound({ sid: "playground:bot", text: t });
    console.log(`→ "${t}" :: ${r.action}${r.detail ? ` (${r.detail})` : ""}`);
  }
  const [row] = await db.select({ q: leads.qState }).from(leads).where(eq(leads.manychatSubId, "playground:bot"));
  const q = row?.q as Record<string, unknown>;
  console.log("productCustom:", q?.productCustom, "| partial:", q?.customDimsPartial ?? null);
  const qr = (q?.quoteResult as string) ?? "";
  console.log("שורת המידה בהצעה:", qr.split("\n")[1] ?? "(אין הצעה)");
}

async function main() {
  const base = ["היי", "רגיל (~90 יום)", "10,000 יחידות", "צריך מידה אחרת", "אחר / מידה מותאמת", "34 על 40"];
  await walk([...base, "12", "צבע אחד", "מעולה, נמשיך"], "תרחיש 1: 34 על 40 → עומק 12");
  await walk([...base, "שטוחה", "צבע אחד", "מעולה, נמשיך"], "תרחיש 2: 34 על 40 → שטוחה");
  await walk([...base, "לא יודע", "בערך", "צבע אחד"], "תרחיש 3: לא עונה על העומק פעמיים");
  const { resetPlayground } = await import("../lib/bot-playground/session");
  await resetPlayground();
}
main().then(() => process.exit(0));
