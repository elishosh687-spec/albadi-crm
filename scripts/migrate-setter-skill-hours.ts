/**
 * One-time: take the hard-coded clock times out of the STORED setter skills.
 *
 * `lib/setter/skills.ts` holds the defaults, but the settings screen stores an
 * editable copy in `app_config → bot.settings`, and that copy WINS. Both
 * carried the example "היום ב-17:00 או מחר ב-11:00", which the generator
 * copied verbatim into 22 of 26 customer messages between 30/08 and 01/09 —
 * six of them offering an hour that had already passed. Fixing the constant
 * alone changes nothing while the stored copy still says it.
 *
 * Only rewrites a field that still matches the OLD default exactly. Anything
 * Eli has edited himself is left alone and reported, so this can't quietly
 * overwrite his wording.
 *
 *   DATABASE_URL="$(…neonctl…)" npx tsx scripts/migrate-setter-skill-hours.ts
 *   …                                                                    --go
 */
import { db } from "../lib/db";
import { sql } from "drizzle-orm";
import { SKILLS } from "../lib/setter/skills";

const GO = process.argv.includes("--go");

const OLD: Record<string, string> = {
  skillAppointmentBooking:
    "היעד: שיחת טלפון בזמן מוגדר, לא 'נדבר מתישהו'. " +
    "הצע חלון קונקרטי אחד או שניים (למשל 'היום ב-17:00 או מחר ב-11:00') — אף פעם לא 'מתי נוח לך?' פתוח, זה מעביר את כל העבודה ללקוח. " +
    "אם חסר ללקוח מידע לשיחה (מידות/לוגו/כמות) — אמור בקצרה מה כדאי שיהיה מולו, כדי שהשיחה תהיה שווה לשני הצדדים. " +
    "מסגר את השיחה כקצרה וקלה: 'שיחה של 10 דקות'. אל תציג אותה כ'פגישה' כבדה.",
  skillCallbackScheduling:
    "כשלקוח אומר 'דבר איתי שבוע הבא' / 'אחרי החג' — זו הסכמה, אל תתווכח איתה. קבע אותה: הפוך את הדחייה לזמן מוגדר ('סגור. יום שני ב-11:00 טוב?'). " +
    "דחייה בלי תאריך היא דחייה לנצח; דחייה עם תאריך היא פגישה. " +
    "אשר בקצרה מה יהיה בשיחה כדי שיגיע מוכן.",
};

const NEW: Record<string, string> = {
  skillAppointmentBooking: SKILLS.appointment_booking.guidance,
  skillCallbackScheduling: SKILLS.callback_scheduling.guidance,
};

async function main() {
  const res: any = await db.execute(sql`SELECT value FROM app_config WHERE key='bot.settings'`);
  const value = (((res as any).rows ?? res) as any[])[0]?.value as Record<string, unknown> | undefined;
  if (!value) {
    console.log("אין bot.settings — אין מה לעדכן.");
    return;
  }

  const next = { ...value };
  let changed = 0;
  for (const key of Object.keys(OLD)) {
    const cur = typeof value[key] === "string" ? (value[key] as string).trim() : "";
    if (!cur) {
      console.log(`· ${key}: ריק — יירש את ברירת המחדל החדשה מהקוד.`);
      continue;
    }
    if (cur === OLD[key].trim()) {
      next[key] = NEW[key];
      changed++;
      console.log(`✓ ${key}: ברירת מחדל ישנה → מוחלפת.`);
    } else if (/\d{1,2}:\d{2}/.test(cur)) {
      console.log(`⚠️  ${key}: נערך ידנית ועדיין מכיל שעה קבועה — לא נגעתי. הטקסט:\n   ${cur.slice(0, 240)}`);
    } else {
      console.log(`· ${key}: נערך ידנית, בלי שעה קבועה — בסדר.`);
    }
  }

  if (!changed) {
    console.log("\nאין שינוי לבצע.");
    return;
  }
  if (!GO) {
    console.log(`\nDRY RUN — ${changed} שדות יתעדכנו. הוסף --go.`);
    return;
  }
  await db.execute(sql`
    UPDATE app_config SET value = ${JSON.stringify(next)}::jsonb, updated_at = now()
    WHERE key = 'bot.settings'`);
  console.log(`\nעודכנו ${changed} שדות.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
