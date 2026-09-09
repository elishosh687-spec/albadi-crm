import { clampToWorkWindow } from "../lib/clock/callback-window";
import { computeCallPrep, prepForSalesperson } from "../lib/autoresponder/call-prep";

function il(d: Date) {
  return d.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem", weekday: "short" });
}

async function main() {
  const cases: [string, string][] = [
    ["מחר ב-2 בלילה", "2026-08-15T02:00:00+03:00"],
    ["מחר ב-11:30", "2026-08-15T11:30:00+03:00"],
    ["שבת בצהריים", "2026-08-15T12:00:00+03:00"],
    ["אתמול (בעבר)", "2026-08-13T10:00:00+03:00"],
  ];
  for (const [label, iso] of cases) {
    const raw = new Date(iso);
    const clamped = await clampToWorkWindow(raw);
    const changed = clamped.getTime() !== raw.getTime();
    console.log(
      `${label.padEnd(18)} | ביקש: ${il(raw)} → נקבע: ${il(clamped)} ${changed ? "(תוקן)" : "(ללא שינוי)"}`
    );
  }
  const prep = await computeCallPrep("playground:bot");
  console.log("\nכותרת המשימה לאיתי:", prepForSalesperson(prep));
}
main().then(() => process.exit(0));
