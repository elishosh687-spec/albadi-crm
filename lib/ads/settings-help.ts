/**
 * The explanation printed beside every input in "מודעות → הגדרות בדיקה":
 * what it controls, where it changes a recommendation, whether it is entered
 * directly or derived, and what happens when it is unset. Client-safe.
 *
 * Every setting is entered directly — nothing is silently derived from another
 * value. Where two numbers are related (CAC ↔ CPL) the screen shows a
 * consistency warning instead of overwriting.
 */
import type { AdRecommendationSettings } from "./recommendation-settings";

export interface SettingHelp {
  /** What it controls and where it bites. */
  help: string;
  /** Only for settings that may be empty. */
  whenUnset?: string;
}

type Paths = {
  [G in keyof AdRecommendationSettings]: `${G & string}.${keyof AdRecommendationSettings[G] & string}`;
}[keyof AdRecommendationSettings];

export const SETTING_HELP: Record<Paths, SettingHelp> = {
  "economics.contributionProfitIls": {
    help: "כמה נשאר מעסקה ראשונה אחרי ייצור, שילוח וטיפול, לפני פרסום ותקורה. משמש לחישוב \"רווח אחרי פרסום\" בכל כרטיס, ולבדיקת ההתאמה מול ה-CAC המקסימלי.",
  },
  "economics.targetLtgpCacRatio": {
    help: "היחס שאתה רוצה בין רווח מלקוח לעלות רכישתו (3 = 3:1). לא מכריע לבד — הוא רק מסביר מאיפה בא ה-CAC המקסימלי, ומופיע באזהרת ההתאמה.",
  },
  "economics.maxCacIls": {
    help: "התקרה לעלות עסקה אחת. מודעה עם עסקה ו-CAC עד התקרה הזו היא \"מועמדת למנצחת\"; מעליה — \"לבדוק כלכליות\". מוזן ישירות, גם אם לא תואם לרווח ÷ יחס.",
  },
  "economics.targetCplIls": {
    help: "המסנן המוקדם: עלות ליד שנחשבת טובה. קובע אם מודעה עוברת את שער היציבות (עד היעד = ממשיכה). מוזן ישירות, גם אם לא תואם ל-CAC ÷ לידים לעסקה.",
  },
  "economics.expectedLeadsPerDeal": {
    help: "הנחת תכנון: כמה לידים צריך בממוצע לעסקה אחת. משמשת רק לאזהרת ההתאמה בין ה-CAC ל-CPL.",
  },
  "economics.dealOverridesCplStop": {
    help: "כשמופעל: מודעה שהביאה עסקה אמיתית ב-CRM נבחנת לפי העסקה וה-CAC, ולעולם לא תקבל \"לעצור\" רק בגלל CPL גבוה. כשכבוי: עצירה לפי CPL גוברת גם על עסקה.",
  },
  "gates.firstGateSpendIls": {
    help: "השער הראשון. הלידים נספרים ברגע שההוצאה המצטברת של המודעה עברה את הסכום הזה — לא אחר כך. מתחתיו המודעה \"אוספת נתונים\".",
  },
  "gates.firstGatePassLeads": {
    help: "כמות לידים בשער הראשון שמספיקה למעבר ברור לבדיקת יציבות.",
  },
  "gates.firstGateReviewMin": {
    help: "תחילת טווח \"דורשת בדיקת איכות\" בשער הראשון. חייב להיות בדיוק אחד מעל מקסימום העצירה, כדי שלכל מספר לידים תהיה החלטה אחת.",
  },
  "gates.firstGateStopMax": {
    help: "בשער הראשון, מספר לידים שווה או קטן מזה = \"מומלץ לעצור מוקדם\" (אלא אם יש עסקה והעסקה גוברת).",
  },
  "gates.stabilitySpendIls": {
    help: "השער השני. ב-CPL עד היעד בנקודה הזו המודעה \"ממשיכה להוכחת עסקה\"; מעליו — \"לעצור אחרי יציבות\". חייב להיות גבוה מהשער הראשון.",
  },
  "gates.dealProofSpendIls": {
    help: "השער האחרון. מודעה שהגיעה לכאן בלי עסקה ב-CRM: \"לעצור ולהמתין להבשלה\", ואחרי ימי ההבשלה — \"מועמדת למפסידה\". חייב להיות גבוה משער היציבות.",
  },
  "gates.maturationDays": {
    help: "כמה ימים מחכים מיום ההוצאה האחרון בפועל (לא מיום יצירת המודעה) לפני שמודעה בלי עסקה נחשבת מועמדת למפסידה. הזמן שבו הלידים שכבר נכנסו יכולים עוד להיסגר.",
  },
  "gates.referenceDailyBudgetIls": {
    help: "לתצוגה בלבד: כמה ימי מסירה צפויים עד כל שער. לא משנה שום תקציב במטא ולא משפיע על אף המלצה.",
  },
  "suitableLead.tag": {
    help: "התגית ב-GHL שאתה שם על ליד מתאים — המקור היחיד ל\"ליד מתאים\". שום שלב, ציון או מודל לא נחשבים. אחרי שינוי, הספירה מתעדכנת רק אחרי שמירה.",
  },
  "suitableLead.qualityOverrideMinSuitable": {
    help: "כמה לידים מתאימים מספיקים כדי שמודעה בטווח בדיקת האיכות (או מעל ה-CPL בשער היציבות) תמשיך בלי החלטה ידנית.",
    whenUnset: "ריק = אין עקיפה. מודעה בטווח הביניים נשארת \"דורשת בדיקת איכות\" עד שתחליט. שיטת הבדיקה המאושרת לא קובעת מספר, ולכן זו ברירת המחדל.",
  },
  "suitableLead.allowQualityOverride": {
    help: "מפעיל את העקיפה לפי לידים מתאימים. אפשר להפעיל רק אחרי שקבעת מינימום למעלה.",
  },
  "structure.maxActiveAds": {
    help: "כמה מודעות מותר שירוצו במקביל בכל החשבון. חריגה מוצגת כאזהרה בלבד — המערכת לא עוצרת שום דבר במטא.",
  },
  "structure.controlSlots": { help: "כמה מודעות Control (מנצחות מוכחות) בסבב." },
  "structure.challengerSlots": { help: "כמה מודעות Challenger לקהל קר נבדקות במקביל." },
  "structure.remarketingSlots": { help: "כמה משבצות רימרקטינג. סך המשבצות לא יכול לעבור את מקסימום המודעות." },
  "structure.evaluateRemarketingSeparately": {
    help: "רימרקטינג ופרוספקטינג מוצגים בנפרד ולא מושווים זה לזה — קהל חם תמיד ייראה זול יותר.",
  },
  "verdict.winnerMinDeals": {
    help: "כמה עסקאות CRM צריך כדי שמודעה תהיה \"מועמדת למנצחת\". פחות מזה, עם CAC תקין — היא ממשיכה להוכחת עסקה.",
  },
  "verdict.winnerRequiresCacAtOrBelowTarget": {
    help: "כשמופעל: מועמדת למנצחת רק אם ה-CAC עד התקרה. כשכבוי: מספיקה כמות העסקאות.",
  },
  "verdict.loserRequiresMaturation": {
    help: "כשמופעל: \"מועמדת למפסידה\" רק אחרי ימי ההבשלה. כשכבוי: מיד כשהגיעה להוצאת הוכחת העסקה בלי עסקה.",
  },
};
