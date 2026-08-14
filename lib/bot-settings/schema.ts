/**
 * Bot settings — one metadata table that drives BOTH the settings UI and the
 * runtime, so a description can never drift from what the setting actually does.
 *
 * CLIENT-SAFE: no server imports, no env reads (see the client-bundle rule in
 * CLAUDE.md). The settings screen imports FIELDS from here; the server reads
 * values through lib/bot-settings/store.ts.
 *
 * Adding a setting:
 *   1. add the key + default to BotSettings / DEFAULT_BOT_SETTINGS
 *   2. add a FIELD entry (label, what it does, where it shows up)
 *   3. WIRE IT — read it in the bot code. An unwired field is a lie; mark it
 *      `wired: false` until it is actually read.
 */

export interface BotSettings {
  // --- customer-facing copy ---
  openingMessage: string;
  reask1: string;
  reask2: string;
  bailReply: string;
  factoryHoldMessage: string;
  confirmFreetextPrompt: string;
  decisionPrompt: string;
  companyCardText: string;

  // --- questionnaire behaviour ---
  pollsEnabled: boolean;
  reaskAttempts: number;
  minQuantity: number;
  handlesDefault: boolean;
  laminationDefault: boolean;

  // --- after the quote ---
  sendCompanyCard: boolean;
  sendDecisionPrompt: boolean;
  showAlternativeShipping: boolean;
  showBookingLink: boolean;
  bookingUrl: string;

  // --- custom (off-catalog) sizes ---
  customSizeMode: string;
  customSizeRangePct: number;
  customSizeNote: string;

  // --- scheduling a call ---
  callbackEnabled: boolean;
  callbackSilenceMinMinutes: number;
  callbackSilenceMaxMinutes: number;
  callbackSendPrepList: boolean;
  callbackPrepIntro: string;

  // --- sales brain ---
  setterDraftsEnabled: boolean;

  // --- models ---
  intentModel: string;
  analysisModel: string;
}

export const DEFAULT_BOT_SETTINGS: BotSettings = {
  openingMessage:
    "שלום! 👋 אני אעזור לך לקבל הצעת מחיר מיידית לשקיות ממותגות. זה ייקח כ-2 דקות 😊",
  reask1: "🤔 לא הצלחתי להבין. אפשר לבחור מספר מהרשימה?",
  reask2:
    "אני עדיין לא קולט — אולי הניסוח שלי לא ברור. תכתבו מספר מהרשימה, או רק את שם האפשרות.",
  bailReply:
    "רגע, נראה לי שעדיף שננהל את זה בטלפון. אחזור אליכם תוך 24 שעות עם המחיר.",
  factoryHoldMessage: "תודה, קיבלתי את המפרט. חוזר אליכם תוך 24-48 שעות עם המחיר.",
  confirmFreetextPrompt:
    "תכתוב מה תרצה לשנות או להוסיף — אפשר חופשי, בעברית.\nלמשל: 'במקום 5000 תהיה 2000', 'מידה אחרת', 'הערה לתערוכה'.",
  decisionPrompt:
    "מה דעתכם על ההצעה?\n\n✅ מתאים → שלחו לנו את הלוגו ונמשיך.\n🔧 רוצים לשנות משהו?",
  companyCardText:
    "👋 *קצת עלינו — אלבדי*\n\n" +
    "חברת אריזות עם 20+ שנה בענף. שותפים במפעל ייצור בסין. מתמחים בשקיות ממותגות לעסקים.",

  pollsEnabled: true,
  reaskAttempts: 3,
  minQuantity: 3000,
  handlesDefault: true,
  laminationDefault: false,

  sendCompanyCard: true,
  sendDecisionPrompt: true,
  showAlternativeShipping: true,
  showBookingLink: true,
  bookingUrl: "https://calendly.com/elishosh687/30min",

  customSizeMode: "exact",
  customSizeRangePct: 8,
  customSizeNote: "* המחיר למידה מותאמת הוא אומדן וכפוף לאישור סופי מול המפעל.",

  callbackEnabled: false,
  callbackSilenceMinMinutes: 30,
  callbackSilenceMaxMinutes: 360,
  callbackSendPrepList: true,
  callbackPrepIntro: "כדי שהשיחה תהיה יעילה, שווה שיהיה מולכם:",

  setterDraftsEnabled: true,

  intentModel: "gpt-4o-mini",
  analysisModel: "gpt-4o",
};

export type FieldType = "toggle" | "number" | "text" | "longtext" | "select";

export interface BotSettingField {
  key: keyof BotSettings;
  group: string;
  label: string;
  /** What this setting actually does — shown next to every control. */
  description: string;
  /** Where in the conversation the customer meets it. */
  where?: string;
  type: FieldType;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** False = shown for transparency but not yet read by the bot. */
  wired?: boolean;
}

export const GROUPS = [
  "הודעות ללקוח",
  "התנהגות השאלון",
  "אחרי ההצעה",
  "מידות מותאמות",
  "תיאום שיחות",
  "מוח מכירות",
  "מודלים",
] as const;

const MODEL_OPTIONS = [
  { value: "gpt-4o-mini", label: "gpt-4o-mini — מהיר וזול (ברירת מחדל היום)" },
  { value: "gpt-4o", label: "gpt-4o — חזק יותר, יקר יותר" },
  { value: "gpt-4.1", label: "gpt-4.1" },
  { value: "gpt-4.1-mini", label: "gpt-4.1-mini" },
];

export const BOT_SETTING_FIELDS: BotSettingField[] = [
  // ---------- הודעות ללקוח ----------
  {
    key: "openingMessage",
    group: "הודעות ללקוח",
    label: "הודעת פתיחה",
    description:
      "ההודעה הראשונה שהבוט שולח לכל ליד חדש, לפני השאלה הראשונה. זו ההרשמה הראשונה של הלקוח מאלבדי.",
    where: "נשלחת פעם אחת, מיד כשליד חדש כותב",
    type: "longtext",
  },
  {
    key: "reask1",
    group: "הודעות ללקוח",
    label: 'ניסיון הבהרה ראשון',
    description:
      "מה הבוט אומר כשהוא לא הבין את התשובה בפעם הראשונה. אחרי ההודעה הזו הוא שואל שוב את אותה שאלה.",
    where: "כשתשובת הלקוח לא תואמת אף אפשרות והמודל לא הצליח לפענח אותה",
    type: "longtext",
  },
  {
    key: "reask2",
    group: "הודעות ללקוח",
    label: "ניסיון הבהרה שני",
    description:
      "הניסוח בפעם השנייה — מכוון להיות רך יותר ולהאשים את הניסוח של הבוט ולא את הלקוח.",
    where: "פסילה שנייה ברצף על אותה שאלה",
    type: "longtext",
  },
  {
    key: "bailReply",
    group: "הודעות ללקוח",
    label: "הודעת מעבר לטלפון",
    description:
      "מה הלקוח מקבל כשהבוט מוותר על השאלון. במקביל אתה מקבל התראה ב-WhatsApp והליד מסומן שצריך התערבות.",
    where: "אחרי מספר הפסילות שהוגדר למטה",
    type: "longtext",
  },
  {
    key: "factoryHoldMessage",
    group: "הודעות ללקוח",
    label: "הודעת המתנה למפעל",
    description:
      "מה נשלח ללקוח כשאי אפשר לתמחר אוטומטית — מידה מחוץ לקטלוג או כמות מתחת למינימום. אתה מקבל את המפרט ב-WhatsApp ומתמחר ידנית.",
    where: "בסוף השאלון, במקום הצעת מחיר",
    type: "longtext",
  },
  {
    key: "confirmFreetextPrompt",
    group: "הודעות ללקוח",
    label: 'הנחיה אחרי "רוצה לשנות"',
    description:
      "מה הבוט מבקש מהלקוח שלחץ על 'רוצה לשנות' במסך האישור. הטקסט החופשי שהלקוח כותב נשלח למודל שמחלץ ממנו את השינויים.",
    where: "מסך האישור בסוף השאלון",
    type: "longtext",
  },
  {
    key: "decisionPrompt",
    group: "הודעות ללקוח",
    label: "שאלת ההמשך אחרי ההצעה",
    description:
      "ההודעה שסוגרת את רצף ההצעה ומזמינה את הלקוח להגיב. התשובה שלו היא מה שמפעיל את זיהוי הכוונות (מתאים / יקר / רוצה לשנות).",
    where: "מיד אחרי הצעת המחיר וכרטיס החברה",
    type: "longtext",
  },
  {
    key: "companyCardText",
    group: "הודעות ללקוח",
    label: "טקסט כרטיס החברה",
    description:
      "הכיתוב שמלווה את סרטון ההיכרות של אלבדי. הסרטון עצמו והקישורים לאתרים ולאינסטגרם נשלחים בנפרד ולא נערכים כאן.",
    where: "אחרי הצעת המחיר, וגם כשלקוח שואל 'מי אתם'",
    type: "longtext",
  },

  // ---------- התנהגות השאלון ----------
  {
    key: "pollsEnabled",
    group: "התנהגות השאלון",
    label: "שאלות כסקר WhatsApp",
    description:
      "כשדולק — כל שאלה נשלחת כסקר עם אפשרויות ללחיצה. כשכבוי — השאלה נשלחת כטקסט והלקוח צריך להקליד את התשובה. סקרים מעלים מאוד את אחוז ההשלמה.",
    where: "כל שאלות השאלון",
    type: "toggle",
  },
  {
    key: "reaskAttempts",
    group: "התנהגות השאלון",
    label: "פסילות לפני מעבר לטלפון",
    description:
      "כמה פעמים הבוט ינסה להבהיר שאלה לפני שהוא מוותר, שולח את הודעת המעבר לטלפון ומתריע לך. מספר נמוך = פחות תסכול ללקוח אבל יותר עבודה ידנית עליך.",
    where: "נספר פר שאלה",
    type: "number",
    min: 1,
    max: 6,
    unit: "פסילות",
  },
  {
    key: "minQuantity",
    group: "התנהגות השאלון",
    label: "כמות מינימלית להצעה אוטומטית",
    description:
      "מתחת לכמות הזו הבוט לא נותן מחיר אלא מנתב למפעל (הודעת ההמתנה + התראה אליך). זה ה-MOQ שהמחשבון יודע לתמחר.",
    where: "נבדק על כמות מותאמת שהלקוח הקליד",
    type: "number",
    min: 100,
    max: 20000,
    step: 100,
    unit: "יחידות",
  },
  {
    key: "handlesDefault",
    group: "התנהגות השאלון",
    label: "ברירת מחדל — ידיות",
    description:
      "השאלה על ידיות הוסרה מהשאלון כדי לקצר אותו, וזו התשובה שמוזנת אוטומטית. 100% מהלקוחות בעבר בחרו עם ידיות. הלקוח יכול לשנות במסך האישור.",
    where: "מוזן לפני מסך האישור",
    type: "toggle",
  },
  {
    key: "laminationDefault",
    group: "התנהגות השאלון",
    label: "ברירת מחדל — למינציה",
    description:
      "גם שאלה שהוסרה. כבוי = בלי למינציה, המחיר הזול יותר. שים לב: 3 צבעים ומעלה מחייבים למינציה בכל מקרה — זה כלל מפעל שגובר על ההגדרה.",
    where: "מוזן לפני מסך האישור",
    type: "toggle",
  },

  // ---------- אחרי ההצעה ----------
  {
    key: "sendCompanyCard",
    group: "אחרי ההצעה",
    label: "לשלוח כרטיס חברה אחרי ההצעה",
    description:
      "כשדולק — מיד אחרי ההצעה נשלח גם כרטיס ההיכרות. כשכבוי — הלקוח מקבל רק את המחיר. הכרטיס עדיין יישלח אם הלקוח ישאל מי אנחנו.",
    where: "הודעה שנייה ברצף ההצעה",
    type: "toggle",
  },
  {
    key: "sendDecisionPrompt",
    group: "אחרי ההצעה",
    label: "לשאול את הלקוח מה דעתו",
    description:
      "כשדולק — אחרי ההצעה נשלחת שאלת ההמשך. כיבוי משאיר את הכדור אצל הלקוח בלי דחיפה, ומוריד את הסיכוי שיגיב.",
    where: "הודעה שלישית ברצף ההצעה",
    type: "toggle",
  },
  {
    key: "showAlternativeShipping",
    group: "אחרי ההצעה",
    label: "להציג חלופת משלוח",
    description:
      "מוסיף להצעה בלוק 'חלופה' עם המחיר בשיטת המשלוח השנייה והחיסכון הפוטנציאלי. נותן ללקוח עוגן להשוואה — אבל גם מסיח מהמחיר שבחרת להציג.",
    where: "בתוך הודעת הצעת המחיר",
    type: "toggle",
  },
  {
    key: "showBookingLink",
    group: "אחרי ההצעה",
    label: "לצרף קישור לקביעת שיחה",
    description:
      "מוסיף להצעה הזמנה לקבוע שיחה קצרה עם הקישור למטה. שים לב: כרגע המערכת לא יודעת אם מישהו קבע דרכו — אין חיבור חזרה ליומן.",
    where: "בתחתית הודעת הצעת המחיר",
    type: "toggle",
  },
  {
    key: "bookingUrl",
    group: "אחרי ההצעה",
    label: "קישור קביעת השיחה",
    description:
      "הכתובת שאליה הלקוח נשלח לקביעת שיחה. משמש רק כשהמתג שמעל דולק.",
    type: "text",
  },

  // ---------- מידות מותאמות ----------
  {
    key: "customSizeMode",
    group: "מידות מותאמות",
    label: "מה לעשות כשלקוח נותן מידה שלא בקטלוג",
    description:
      "עד היום כל מידה מותאמת נשלחה אליך לתמחור ידני והלקוח חיכה 24-48 שעות. עכשיו המחשבון המשוער יודע לתמחר כל מידה (דיוק ~±10%). בחר איך הלקוח מקבל את זה.",
    where: "בסוף השאלון, כשנבחרה מידה חופשית",
    type: "select",
    options: [
      { value: "exact", label: "מחיר מדויק + הסתייגות (מומלץ)" },
      { value: "range", label: "טווח מחירים — פחות מחייב" },
      { value: "off", label: "כבוי — לשלוח אליך לתמחור ידני (ההתנהגות הישנה)" },
    ],
  },
  {
    key: "customSizeRangePct",
    group: "מידות מותאמות",
    label: "רוחב הטווח",
    description:
      "כמה אחוזים למעלה ולמטה סביב האומדן כשנבחר מצב 'טווח מחירים'. 8% על אומדן של ₪6,000 יציג בערך ₪5,520–₪6,480. לא רלוונטי במצבים האחרים.",
    type: "number",
    min: 3,
    max: 25,
    unit: "%",
  },
  {
    key: "customSizeNote",
    group: "מידות מותאמות",
    label: "הסתייגות שמצורפת לאומדן",
    description:
      "שורה שנוספת להצעה על מידה מותאמת בלבד — הצעות מהקטלוג לא מקבלות אותה. זה מה שמשאיר לך מקום לתקן אם המפעל יחזיר מספר אחר.",
    where: "בתחתית ההצעה, לפני פרטי החברה",
    type: "text",
  },

  // ---------- תיאום שיחות ----------
  {
    key: "callbackEnabled",
    group: "תיאום שיחות",
    label: "לבקש מלקוחות שקטים זמן לשיחה",
    description:
      "המנוע שמזהה לקוח ששתק וכותב לו 'מתי נוח שנתקשר?'. כשהלקוח עונה בזמן — נפתחת אוטומטית משימה עם השעה, והוא מקבל אישור. ⚠️ זה שולח הודעות ללקוחות אמיתיים — הדליקו רק כשאתם מוכנים.",
    where: "רץ ברקע על לידים ששתקו; התשובה מטופלת מיד",
    type: "toggle",
  },
  {
    key: "callbackSilenceMinMinutes",
    group: "תיאום שיחות",
    label: "אחרי כמה זמן שקט לפנות",
    description:
      "כמה דקות של שתיקה מצד הלקוח לפני שהבוט מבקש זמן לשיחה. קצר מדי מרגיש נודניק; ארוך מדי והלקוח כבר התקרר.",
    type: "number",
    min: 10,
    max: 1440,
    step: 5,
    unit: "דקות",
  },
  {
    key: "callbackSilenceMaxMinutes",
    group: "תיאום שיחות",
    label: "עד כמה זמן שקט עוד רלוונטי",
    description:
      "גבול עליון שמונע מהבוט לפנות לכל הלידים הישנים בבת אחת. ליד ששתק יותר מזה נחשב 'צונן' ומטופל במעקב הרגיל, לא בפלואו הזה.",
    where: "הגנה מפני פיצוץ הודעות בהדלקה הראשונה",
    type: "number",
    min: 60,
    max: 10080,
    step: 30,
    unit: "דקות",
  },
  {
    key: "callbackSendPrepList",
    group: "תיאום שיחות",
    label: "לצרף רשימת הכנה לשיחה",
    description:
      "מוסיף להודעה רשימה של מה שחסר ללקוח הזה ספציפית — מידות, לוגו, כמות — לפי מה שכבר ידוע עליו במערכת. הרשימה נשלחת פעמיים: בבקשת הזמן, ושוב באישור אחרי שנקבעה שעה. זה מה שמונע שיחות של 'תביאו לי מידות'.",
    where: "בסוף בקשת הזמן ובאישור",
    type: "toggle",
  },
  {
    key: "callbackPrepIntro",
    group: "תיאום שיחות",
    label: "משפט הפתיחה של רשימת ההכנה",
    description:
      "השורה שמופיעה מעל רשימת ההכנה. הרשימה עצמה נבנית אוטומטית מהנתונים של הלקוח ולא נערכת כאן.",
    type: "text",
  },

  // ---------- מוח מכירות ----------
  {
    key: "setterDraftsEnabled",
    group: "מוח מכירות",
    label: "הסטר כותב את הטיוטות",
    description:
      "כשדולק — ברגעי הכסף (מו״מ, סירוב, שינוי מפרט) ובפולו-אפים, הטיוטה שמחכה לאישורך נכתבת על ידי מוח המכירות: ניתוח מצב → טקטיקה → ניסוח → ולידציה. כשכבוי — המנסח הישן. בשני המצבים שום דבר לא נשלח בלי האישור שלך; המתג קובע רק מי כותב את ההצעה.",
    where: "תור הטיוטות",
    type: "toggle",
  },

  // ---------- מודלים ----------
  {
    key: "intentModel",
    group: "מודלים",
    label: "מודל שיחה",
    description:
      "המודל שמסווג את כוונת הלקוח אחרי ההצעה (מתאים / יקר לי / רוצה לשנות), מחלץ מפרט מטקסט חופשי, ומנסה להבין תשובות שלא תואמות אף אפשרות. זה המודל שקובע כמה הבוט 'חד' בעברית.",
    where: "כל הבנת שפה בשיחה",
    type: "select",
    options: MODEL_OPTIONS,
  },
  {
    key: "analysisModel",
    group: "מודלים",
    label: "מודל ניתוח",
    description:
      "המודל של כפתור 'נתח' — הניתוח המכירתי העמוק פר ליד. כבד ויקר יותר, רץ הרבה פחות, ולכן שווה לו מודל חזק.",
    where: "לשונית ניתוח + הערות ב-GHL",
    type: "select",
    options: MODEL_OPTIONS,
  },
];

/** Merge stored values over defaults, dropping unknown/!typed keys. */
export function normalizeBotSettings(raw: unknown): BotSettings {
  const out: BotSettings = { ...DEFAULT_BOT_SETTINGS };
  if (!raw || typeof raw !== "object") return out;
  const src = raw as Record<string, unknown>;
  for (const field of BOT_SETTING_FIELDS) {
    const v = src[field.key];
    if (v === undefined || v === null) continue;
    if (field.type === "toggle" && typeof v === "boolean") {
      (out[field.key] as boolean) = v;
    } else if (field.type === "number" && typeof v === "number" && Number.isFinite(v)) {
      const clamped = Math.min(field.max ?? v, Math.max(field.min ?? v, v));
      (out[field.key] as number) = clamped;
    } else if (
      (field.type === "text" || field.type === "longtext" || field.type === "select") &&
      typeof v === "string" &&
      v.trim() !== ""
    ) {
      (out[field.key] as string) = v;
    }
  }
  return out;
}
