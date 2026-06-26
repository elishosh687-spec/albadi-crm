/**
 * Stage plays — the salesperson's "what to do now" for a lead, keyed by the
 * analyzed primary_blocker (NOT the manual pipeline stage, which is often
 * stale). The analyzer tags each lead with a blocker; the נתח panel looks up
 * the matching play here and shows it.
 *
 * Pure data, client-safe (no server deps). Content mirrors
 * docs/SALES-PLAYBOOK.he.md. Grounded in the 2026-06-26 49-verdict study:
 * no physical samples (see memory no-physical-samples), no quantity-pushing,
 * no first-move discounts.
 */

export type BlockerKey =
  | "price"
  | "moq"
  | "sample_trust"
  | "payment_terms"
  | "product_mismatch"
  | "followup_drop"
  | "spec_open"
  | "wrong_lead"
  | "other";

export interface StagePlay {
  /** Short Hebrew title of the move. */
  title: string;
  /** Which funnel stage this typically maps to. */
  stage: string;
  /** The lines the salesperson should say. */
  lines: string[];
  /** The concrete next step / exit. */
  nextStep: string;
}

const PLAYS: Record<BlockerKey, StagePlay> = {
  product_mismatch: {
    title: "סינון / פסילה מהירה",
    stage: "פתיחה",
    lines: [
      "אתה מחפש שקית בד אלבד ממותגת? כי אם זה ניילון / קרטון / קופסאות — זה לא הקו שלנו ולא אבזבז לך זמן.",
    ],
    nextStep: "רוצה ניילון/קרטון/קופסה → סמן LOST (לא_רלוונטי) מיד. אלבד → המשך.",
  },
  wrong_lead: {
    title: "סינון / פסילה מהירה",
    stage: "פתיחה",
    lines: [
      "לוודא שזה בכלל ליד אמיתי שמחפש שקיות אלבד ממותגות. אם לא — לא לבזבז עליו את המשפך.",
    ],
    nextStep: "לא רלוונטי → LOST (לא_רלוונטי). רלוונטי → איסוף גודל/כמות/לוגו.",
  },
  price: {
    title: "פירוק מחיר + 'אנחנו המפעל'",
    stage: "INTAKE / מו״מ",
    lines: [
      "המחיר שלי הוא הישיר מהמפעל שאנחנו שותפים בו — בלי תיווך.",
      "הזול שמצאת (סין) כולל שילוח עד הדלת, מכס וגלופה, או רק את השקית במפעל? בוא נשווה עלות סופית עד הדלת.",
      "('סתם יקר'): מה הטווח שחשבת עליו? אגיד בכנות אם אפשר להגיע לשם. (לא הנחה ראשון, לא להתמקח מול עצמך.)",
    ],
    nextStep: "השוואת עלות-סופית → נעילת מחיר → סגירה.",
  },
  moq: {
    title: "מדרגת כניסה (לא לדחוף כמות)",
    stage: "INTAKE",
    lines: [
      "אני רואה שאתה מתחיל בקטן — יש מדרגת כניסה שמתאימה לכמות שלך, נתחיל משם בלי שתסתכן בגדול.",
      "אל תדחוף 5000 — זה מה שמפיל קונים קטנים.",
    ],
    nextStep: "סגירה על כמות-כניסה; הרחבה בהזמנה הבאה.",
  },
  sample_trust: {
    title: "הוכחה ויזואלית/חברתית (לא דוגמה!)",
    stage: "כל שלב",
    lines: [
      "אשלח לך תמונות וסרטון של השקיות האמיתיות + עסקים שכבר עובדים איתנו עם המיתוג שלהם.",
      "אנחנו שותפים במפעל בסין — זה מגיע ישר מהקו, באיכות שאתה רואה.",
      "(רק אם ממש מתעקש): אפשר גם דוגמה פיזית, אבל זה מעכב את ההזמנה בכמה שבועות — עדיף שנתקדם.",
    ],
    nextStep: "הוכחה ויזואלית → להמשיך למחיר/סגירה בלי לעכב.",
  },
  payment_terms: {
    title: "תנאי תשלום 50/50",
    stage: "מו״מ",
    lines: [
      "50% בהזמנה, 50% כשהסחורה מגיעה לארץ — אתה לא משלם את החצי השני עד שהיא פיזית כאן.",
    ],
    nextStep: "סיכום תנאים → אישור הזמנה.",
  },
  spec_open: {
    title: "מועד ברור + אחריות על גרפיקה",
    stage: "בדיקת מפעל",
    lines: [
      "בודק את המפרט מול המפעל. חוזר אליך עד [יום ושעה] עם מחיר סופי — וגם אם אין חדש, אעדכן.",
      "אל תתעסק עם הקבצים — אנחנו נדאג לפריסה ולקובץ ההדפסה, אתה רק תשלח לוגו.",
    ],
    nextStep: "מחיר/פריסה סופיים → מו״מ/סגירה.",
  },
  followup_drop: {
    title: "נעילת מועד חזרה",
    stage: "כל שלב",
    lines: [
      "מתנצל על העיכוב. שולח לך עכשיו את מה שהבטחתי, וקובע איתך יום ושעה לחזרה — אני לא נעלם.",
    ],
    nextStep: "לנעול מועד קונקרטי ולמסור את מה שהובטח.",
  },
  other: {
    title: "טיפול נקודתי",
    stage: "—",
    lines: [
      "אין חסם מובהק — קרא את הסיכום והציטוטים בכרטיס, וטפל לפי מה שעלה בשיחה.",
    ],
    nextStep: "לפי ההקשר הספציפי.",
  },
};

export function getStagePlay(blocker: string | null | undefined): StagePlay {
  return PLAYS[(blocker as BlockerKey) in PLAYS ? (blocker as BlockerKey) : "other"];
}
