/**
 * Restart Mode — one-time grouping of stuck leads after a long pause.
 *
 * Reads all active leads, classifies them into action groups based on notes
 * and tag, and outputs a re-engagement plan.
 *
 * Run: npm run bot:restart
 */
import "dotenv/config";
import { getSubscriber, getFieldValue } from "../lib/manychat/client";
import { TAG_IDS, TERMINAL_TAGS } from "../lib/manychat/config";

const KNOWN_SUBSCRIBERS = [
  "1290975646", "335237336", "843866619", "1567115769", "2035644170",
  "1884294789", "1602697859", "933250256", "1945485008", "2121695200",
  "21902603", "342493590", "1342391971", "647013452", "235009133",
  "1109877399", "1233780185", "1168653412", "1745508158", "1559024601",
  "940287852", "969554152", "24594158", "1513055758", "1986772872",
  "3658499", "1890126495", "248319497", "221677737", "347894123",
  "869425808", "1768242677", "956589647", "771607363", "1720207271",
  "774945448", "1701651968", "1258938556", "306431271",
];

const tagIdToName: Record<number, string> = Object.fromEntries(
  Object.entries(TAG_IDS).map(([k, v]) => [v, k])
);

interface Lead {
  subscriberId: string;
  name: string;
  currentTag: string | null;
  notes: string | null;
  quoteTotal: number | null;
  followUp: string | null;
}

type GroupKey =
  | "high_value_personal_call"      // > 10K — אלי מתקשר
  | "quote_sent_followup"            // הצעה נשלחה — חזרה עם הזכר
  | "after_holiday"                  // אמרו "אחרי החג"
  | "said_too_expensive"             // "אמר יקר"
  | "requested_call_no_answer"       // ביקש שיחה, לא טופל
  | "questionnaire_incomplete"       // התחיל שאלון לא סיים
  | "already_marked_no_answer"       // כבר במצב לא_ענה
  | "broken_lead"                    // אנומליה
  | "manual_review";                 // לא ברור

const GROUP_TEMPLATES: Record<GroupKey, { title: string; template: string; action: string }> = {
  high_value_personal_call: {
    title: "🔴 שיחה אישית מאלי (לא טמפלייט)",
    template: "אין טמפלייט. אלי מתקשר ישירות.",
    action: "התקשר לפי סדר עדיפות. עסקאות 10K+.",
  },
  quote_sent_followup: {
    title: "📨 הצעה נשלחה — תזכורת",
    template:
      "היי {name}, חוזר לבדוק על ההצעה שלנו ({quoteTotal} ש\"ח). " +
      "נוצרה אצלי איזו חציצה לאחרונה ולא חזרתי בזמן — סליחה. " +
      "ההצעה עוד בתוקף, רוצה להתקדם?",
    action: "שלח טמפלייט. אם עונה → סווג מחדש לפי תשובה. אם 5+ ימים שקט → לא_ענה.",
  },
  after_holiday: {
    title: "🕯️ \"אחרי החג\"",
    template:
      "היי {name}, החג נגמר וחזרנו לפעילות מלאה. " +
      "דיברנו על {productHint} — רוצה להתקדם?",
    action: "שלח טמפלייט. תשובה → סווג. שקט 5 ימים → לא_ענה.",
  },
  said_too_expensive: {
    title: "💸 \"אמר יקר\"",
    template:
      "היי {name}, מבין שהצעת המחיר הייתה גבוהה. " +
      "יש כמה דברים שאפשר להוריד (כמות, צבעים, סוג חומר) שיכולים לשנות. " +
      "רוצה לעבור על האפשרויות יחד?",
    action: "שלח טמפלייט אבל גם הסלם לאלי לשיחה — שיקול מחיר דורש אותך.",
  },
  requested_call_no_answer: {
    title: "📞 ביקשו שיחה ולא קיבלו",
    template:
      "היי {name}, סליחה שלא חזרנו אליך — היו תקלות אצלי בצד. " +
      "רוצה שאתקשר אליך השבוע? איזה זמן הכי נוח?",
    action: "שלח טמפלייט. כשעונה — אלי מתקשר.",
  },
  questionnaire_incomplete: {
    title: "📝 שאלון לא הושלם",
    template:
      "היי {name}, ראיתי שהתחלת לבדוק אריזות ולא סיימת. " +
      "רוצה שנמשיך מאיפה שעצרנו? לוקח דקה.",
    action: "שלח טמפלייט. עונה → continue questionnaire. לא עונה 5 ימים → לא_ענה.",
  },
  already_marked_no_answer: {
    title: "⚪ כבר לא_ענה — ניסיון אחרון",
    template:
      "היי {name}, ניסיון אחרון מאיתנו. אם עוד יש עניין באריזות — תכתוב חזרה. " +
      "אחרת לא נטריד שוב.",
    action: "שלח טמפלייט. אין תשובה 7 ימים → לא_רלוונטי.",
  },
  broken_lead: {
    title: "❌ ליד שבור — דורש בדיקה ידנית",
    template: "אין טמפלייט.",
    action: "אלי בודק ב-ManyChat ידנית.",
  },
  manual_review: {
    title: "🟡 לא ברור — אלי מחליט",
    template: "אין טמפלייט אוטומטי.",
    action: "אלי קורא ומחליט.",
  },
};

function classify(lead: Lead): GroupKey {
  const notes = (lead.notes || "").toLowerCase();
  const tag = lead.currentTag;

  if (lead.currentTag === null && lead.name === lead.subscriberId) {
    return "broken_lead";
  }

  if (lead.quoteTotal && lead.quoteTotal >= 10000) {
    return "high_value_personal_call";
  }

  if (notes.includes("יקר")) {
    return "said_too_expensive";
  }

  if (notes.includes("אחרי החג") || notes.includes("אחרי חג")) {
    return "after_holiday";
  }

  if (notes.includes("לחץ תיאום שיחה") || notes.includes("רוצה לדבר") || notes.includes("עם סוכן")) {
    return "requested_call_no_answer";
  }

  if (tag === "לא_ענה") {
    return "already_marked_no_answer";
  }

  if (
    tag === "ליד_חדש" ||
    (notes.includes("מילא חלקי") || notes.includes("לא מילא") || notes.includes("חלקי"))
  ) {
    return "questionnaire_incomplete";
  }

  if (lead.quoteTotal && lead.quoteTotal > 0) {
    return "quote_sent_followup";
  }

  if (tag === "הצעה_בוט" || tag === "הצעה_טלפון") {
    return "quote_sent_followup";
  }

  return "manual_review";
}

async function main() {
  const leads: Lead[] = [];

  for (const sid of KNOWN_SUBSCRIBERS) {
    try {
      const sub = await getSubscriber(sid);
      const tagIds = sub.tags.map((t) => t.id);
      if (tagIds.some((id) => TERMINAL_TAGS.includes(id))) continue;

      const currentTag = tagIds.map((id) => tagIdToName[id]).filter(Boolean)[0] ?? null;
      const notes = getFieldValue(sub.custom_fields, "notes");
      const quoteTotal = getFieldValue(sub.custom_fields, "quote_total");
      const followUp = getFieldValue(sub.custom_fields, "follow_up_date");

      leads.push({
        subscriberId: sid,
        name: sub.name ?? sid,
        currentTag,
        notes: notes ? String(notes) : null,
        quoteTotal: quoteTotal ? Number(quoteTotal) : null,
        followUp: followUp ? String(followUp) : null,
      });
    } catch {
      // skip
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  const groups: Record<GroupKey, Lead[]> = {
    high_value_personal_call: [],
    quote_sent_followup: [],
    after_holiday: [],
    said_too_expensive: [],
    requested_call_no_answer: [],
    questionnaire_incomplete: [],
    already_marked_no_answer: [],
    broken_lead: [],
    manual_review: [],
  };

  for (const lead of leads) {
    const key = classify(lead);
    groups[key].push(lead);
  }

  // Print plan
  console.log("\n=== Albadi Restart Plan ===\n");
  console.log(`Total active leads: ${leads.length}\n`);

  for (const [key, list] of Object.entries(groups) as [GroupKey, Lead[]][]) {
    if (list.length === 0) continue;
    const meta = GROUP_TEMPLATES[key];
    console.log(`\n${meta.title}  (${list.length})`);
    console.log("─".repeat(60));
    console.log(`Action: ${meta.action}`);
    console.log(`\nטמפלייט מוצע:`);
    console.log(meta.template);
    console.log(`\nלידים בקבוצה:`);
    for (const l of list) {
      const q = l.quoteTotal ? `${l.quoteTotal} ש"ח` : "אין quote";
      console.log(`  • ${l.name}  [${l.currentTag ?? "?"}]  ${q}`);
      if (l.notes) console.log(`    notes: ${l.notes}`);
    }
  }

  console.log("\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
