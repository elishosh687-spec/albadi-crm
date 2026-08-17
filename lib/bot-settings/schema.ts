import { SKILLS, type SkillId } from "../setter/skills";

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

  // --- talking to a human instead of the bot ---
  humanHandoffHintEnabled: boolean;
  humanHandoffHint: string;
  humanHandoffReply: string;

  // --- handing the keys back to the bot ---
  autoResumeEnabled: boolean;
  autoResumeHours: number;

  // --- follow-up rhythm ---
  followupsEnabled: boolean;
  followupMaxAttempts: number;
  followupCadenceMidQuestionnaire: string;
  followupCadenceIntake: string;
  followupCadenceAwaitingLogo: string;
  followupCadenceConsideration: string;
  followupCadenceReengage: string;

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
  setterLiveEnabled: boolean;
  setterWritesFollowups: boolean;
  setterPhrasesStateReplies: boolean;
  followupSupervisorEnabled: boolean;
  setterModel: string;
  setterMaxWords: number;
  setterStyle: string;
  setterGoneQuietHours: number;
  skillAppointmentBooking: string;
  skillBuyingSignal: string;
  skillObjectionExplore: string;
  skillObjectionPriceAer: string;
  skillMicroCommitment: string;
  skillGhostRecovery: string;
  skillCallbackScheduling: string;
  skillFlowManagement: string;
  skillFollowUpDiscipline: string;
  skillPauseIntelligence: string;

  // --- models ---
  intentModel: string;
  analysisModel: string;
  transcribeProvider: string;
  transcribeModel: string;
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

  humanHandoffHintEnabled: true,
  humanHandoffHint: 'רוצים לדבר עם בן אדם במקום? פשוט תכתבו "כבה בוט" ואחזור אליכם.',
  humanHandoffReply:
    "בסדר גמור, כיביתי את הבוט 🙂 בן אדם מאלבדי יחזור אליכם בהקדם. אפשר לכתוב כאן בינתיים כל מה שחשוב.",

  autoResumeEnabled: true,
  autoResumeHours: 48,

  followupsEnabled: true,
  followupMaxAttempts: 3,
  followupCadenceMidQuestionnaire: "1,1,1",
  followupCadenceIntake: "2,12,23",
  followupCadenceAwaitingLogo: "2,12,23",
  followupCadenceConsideration: "2,12,23",
  followupCadenceReengage: "72",

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
  setterLiveEnabled: false,
  setterWritesFollowups: true,
  setterPhrasesStateReplies: true,
  followupSupervisorEnabled: false,
  setterModel: "gpt-5.6-terra",
  setterMaxWords: 60,
  setterStyle:
    "עברית ישראלית טבעית של WhatsApp, לא מתורגמת ולא תאגידית. רעיון אחד, שאלה אחת לכל היותר, בלי רשימות, אימוג'י אחד לכל היותר. אל תהיה מתחנף ואל תלחץ.",
  setterGoneQuietHours: 12,
  skillAppointmentBooking: SKILLS.appointment_booking.guidance,
  skillBuyingSignal: SKILLS.buying_signal_amplification.guidance,
  skillObjectionExplore: SKILLS.objection_explore.guidance,
  skillObjectionPriceAer: SKILLS.objection_price_aer.guidance,
  skillMicroCommitment: SKILLS.micro_commitment.guidance,
  skillGhostRecovery: SKILLS.ghost_recovery.guidance,
  skillCallbackScheduling: SKILLS.callback_scheduling.guidance,
  skillFlowManagement: SKILLS.flow_management.guidance,
  skillFollowUpDiscipline: SKILLS.follow_up_discipline.guidance,
  skillPauseIntelligence: SKILLS.pause_intelligence.guidance,

  intentModel: "gpt-5.6-luna",
  analysisModel: "gpt-5.6-terra",
  transcribeProvider: "openai",
  transcribeModel: "whisper-1",
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
  "קצב התזכורות",
  "התנהגות השאלון",
  "אחרי ההצעה",
  "מידות מותאמות",
  "תיאום שיחות",
  "מוח מכירות",
  "טקטיקות המכירה",
  "מודלים",
] as const;

const MODEL_OPTIONS = [
  { value: "gpt-5.6-luna", label: "GPT-5.6 Luna — זול מאוד ($0.20/M), מהיר" },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra — מאוזן ($2/M)" },
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol — הדגל ($5/M), יקר" },
  { value: "gpt-4o-mini", label: "gpt-4o-mini — הדור הקודם (גיבוי)" },
  { value: "gpt-4o", label: "gpt-4o — הדור הקודם (גיבוי)" },
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

  {
    key: "humanHandoffHintEnabled",
    group: "הודעות ללקוח",
    label: 'להציע ללקוח לכבות את הבוט',
    description:
      "כשדולק — הבוט מספר ללקוח שאפשר לעבור לבן אדם: פעם אחת בתחילת השיחה, ושוב אם הוא לא מצליח להבין את התשובות. הלקוח שכותב \"כבה בוט\" מקבל שקט מיידי ואתה מקבל התראה — הליד לא הולך לאיבוד ולא מסומן כאבוד.",
    where: "בהודעת הפתיחה, ובניסיון ההבהרה השני",
    type: "toggle",
  },
  {
    key: "humanHandoffHint",
    group: "הודעות ללקוח",
    label: "המשפט שמציע לכבות את הבוט",
    description:
      "השורה שנוספת בסוף הודעת הפתיחה וכשהבוט מתקשה להבין. שווה שתישאר קצרה ותכיל את המילים שהלקוח אמור לכתוב.",
    where: "מתווסף להודעות קיימות, לא נשלח כהודעה נפרדת",
    type: "longtext",
  },
  {
    key: "humanHandoffReply",
    group: "הודעות ללקוח",
    label: 'התשובה ל"כבה בוט"',
    description:
      "מה הלקוח מקבל ברגע שביקש לעבור לבן אדם. מיד אחרי זה הבוט שותק בשיחה הזו ואתה מקבל התראה ב-WhatsApp.",
    where: 'כשהלקוח כותב "כבה בוט", "לדבר עם נציג" וכדומה',
    type: "longtext",
  },

  {
    key: "autoResumeEnabled",
    group: "הודעות ללקוח",
    label: "להחזיר את הבוט לעבודה אוטומטית",
    description:
      "ברגע שאתה עונה ללקוח בעצמו, הבוט משתתק בשיחה הזו — וזה נכון, אתה מנהל אותה. הבעיה היא שההשתקה נשארה לנצח: נמדד שב-81 מתוך 117 לידים פעילים הבוט היה מושתק לצמיתות, כך שהשאלון, המעקבים ומוח המכירות לא פעלו כמעט על אף שיחה חיה. כשדולק — השתקה כזו פגה מעצמה אחרי הזמן שלמטה.\n\nלא נוגע בלקוח שביקש להסיר, בלקוח שביקש בן אדם, בעסקה שנסגרה, או בליד שסימנת ידנית — אלה נשארים שקטים תמיד.",
    where: "רץ כל שעה ברקע",
    type: "toggle",
  },
  {
    key: "autoResumeHours",
    group: "הודעות ללקוח",
    label: "אחרי כמה שעות הבוט חוזר",
    description:
      "נספר מרגע ההשתקה. קצר מדי — הבוט יתפרץ לשיחה שאתה עוד מנהל; ארוך מדי — לידים ממשיכים ליפול בין הכיסאות. 48 שעות זה יומיים עסקים.",
    where: "רלוונטי רק כשהמתג למעלה דלוק",
    type: "number",
    min: 2,
    max: 336,
    unit: "שעות",
  },

  // ---------- קצב התזכורות ----------
  {
    key: "followupsEnabled",
    group: "קצב התזכורות",
    label: "תזכורות ללקוחות שלא ענו",
    description:
      "כשכבוי — הבוט לא שולח אף תזכורת לאף לקוח. ההסלמות אליך והתזכורת היומית על המפעל ממשיכות לעבוד.",
    where: "רץ כל רבע שעה ברקע",
    type: "toggle",
  },
  {
    key: "followupMaxAttempts",
    group: "קצב התזכורות",
    label: "כמה תזכורות לפני שמוותרים",
    description:
      "אחרי המספר הזה הבוט מפסיק לנדנד, משתיק את עצמו בשיחה ושולח לך התראה — הליד עובר אליך. לא חל על שלב חידוש הקשר, שם התזכורות נמשכות עד שהלקוח עונה.",
    where: "נספר פר ליד",
    type: "number",
    min: 1,
    max: 8,
    unit: "תזכורות",
  },
  {
    key: "followupCadenceIntake",
    group: "קצב התזכורות",
    label: "אחרי שנשלחה הצעה",
    description:
      "כמה שעות להמתין לפני כל תזכורת, מופרד בפסיקים. \"2,12,23\" = תזכורת אחרי שעתיים, עוד אחת 12 שעות אחריה, ועוד אחת 23 שעות אחריה.\n\nזה השלב הכי חשוב — כאן הלקוח מחזיק הצעה ומחליט.",
    where: "שלב קליטה, אחרי שהבוט שלח מחיר",
    type: "text",
  },
  {
    key: "followupCadenceMidQuestionnaire",
    group: "קצב התזכורות",
    label: "נטש באמצע השאלון",
    description:
      "לקוח שהתחיל לענות והפסיק. כאן שווה להיות מהיר — הוא עדיין באמצע משהו.",
    where: "לפני שנשלחה הצעה",
    type: "text",
  },
  {
    key: "followupCadenceAwaitingLogo",
    group: "קצב התזכורות",
    label: "מחכים ללוגו",
    description: "הלקוח אמר שההצעה מתאימה ולא שלח את הלוגו.",
    where: "אחרי אישור ההצעה",
    type: "text",
  },
  {
    key: "followupCadenceConsideration",
    group: "קצב התזכורות",
    label: "אחרי המחיר הסופי",
    description: "הלקוח מחזיק את המחיר הסופי ושוקל.",
    where: "שלב שוקל / משא ומתן",
    type: "text",
  },
  {
    key: "followupCadenceReengage",
    group: "קצב התזכורות",
    label: "חידוש קשר עם ליד קר",
    description:
      "לידים שגררת ידנית ל״חידוש קשר״. ערך אחד — הוא חוזר על עצמו ללא הגבלה עד שהלקוח עונה או מבקש להסיר. 72 שעות = כל 3 ימים.",
    where: "רק בשלב חידוש קשר",
    type: "text",
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
    key: "setterLiveEnabled",
    group: "מוח מכירות",
    label: "🔴 הסטר עונה ללקוחות בשיחה החיה",
    description:
      "המתג הגדול. כשדולק — בשלב שאחרי ההצעה, תשובות מדוברות (התנגדויות, מו״מ, שאלות) נכתבות ונשלחות על ידי הסטר ישירות ללקוח, במקום המשפטים הכתובים-מראש של הבוט הישן. פעולות שמשנות מצב נשארות אצל הבוט הישן תמיד: לקוח שמאשר (→ בקשת לוגו), שינוי מפרט (→ תמחור מחדש אמיתי), קבלת קבצים, והשאלון כולו. אם הסטר נכשל או פוסל את עצמו — הבוט הישן עונה, אז ללקוח תמיד יש תשובה. כיבוי מחזיר הכל להתנהגות הישנה מיידית.",
    where: "כל הודעת לקוח אחרי הצעת מחיר",
    type: "toggle",
  },
  {
    key: "setterDraftsEnabled",
    group: "מוח מכירות",
    label: "הסטר כותב את הטיוטות",
    description:
      "כשדולק — ברגעי הכסף (מו״מ, סירוב, שינוי מפרט) ובפולו-אפים, הטיוטה שמחכה לאישורך נכתבת על ידי מוח המכירות: ניתוח מצב → טקטיקה → ניסוח → ולידציה. כשכבוי — המנסח הישן. בשני המצבים שום דבר לא נשלח בלי האישור שלך; המתג קובע רק מי כותב את ההצעה.",
    where: "תור הטיוטות",
    type: "toggle",
  },

  // ---------- מוח מכירות + טקטיקות ----------

  {
    key: "setterWritesFollowups",
    group: "מוח מכירות",
    label: "מוח המכירות כותב את התזכורות",
    description:
      "כשדולק — כל תזכורת נכתבת מחדש לפי השיחה הספציפית של הלקוח, במקום אחד מ-13 המשפטים הקבועים. לקוח שהתווכח על מחיר ולקוח שנעלם באמצע השאלון מקבלים דברים שונים.\n\nהקוד עדיין מחליט מתי לשלוח ולמי — הקצב, מספר הניסיונות, שעות השקט. מוח המכירות רק מנסח. אם הניסוח נכשל או נפסל בבדיקות, נשלח הטקסט הקבוע כרגיל, אז אין מצב שלקוח לא יקבל תזכורת בגלל זה.",
    where: "כל תזכורת ללקוח שלא ענה",
    type: "toggle",
  },
  {
    key: "setterPhrasesStateReplies",
    group: "מוח מכירות",
    label: "מוח המכירות מנסח גם את רגעי ההחלטה",
    description:
      "הרגעים שבהם הלקוח אומר \"מתאים לי\", שולח לוגו, או מבקש לשנות מפרט — 14 משפטים שכל לקוח שמע בדיוק אותו דבר. **הפעולה נשארת בקוד** (הליד מתקדם, הבוט משתתק, המחיר מחושב מחדש) ורק הניסוח עובר למוח המכירות.\n\nהבקשה עצמה מוגנת: אם ההודעה החדשה לא מבקשת את הלוגו כשצריך לבקש לוגו — היא נזרקת ונשלח המשפט הקבוע. עדיף לאבד ניסוח אישי מאשר לשבור את הזרימה.\n\nדורש שגם \"הסטר עונה בשיחה החיה\" יהיה דלוק.",
    where: "כשהלקוח מאשר, שולח לוגו, או משנה מפרט",
    type: "toggle",
  },
  {
    key: "followupSupervisorEnabled",
    group: "מוח מכירות",
    label: "שכבת מפקח נוספת על התזכורות",
    description:
      "שכבה ישנה יותר שנבנתה כדי לשפר את הטקסט הקבוע לפני שמוח המכירות היה קיים. **כבויה כברירת מחדל** — היא כותבת מחדש 80% מההודעות בלי הבדיקות המכניות של מוח המכירות (אחת מהן ציטטה מחיר ליחידה ללקוח), והיא זו שהשתיקה 234 לידים והעבירה אותם אליך.\n\nכשכבויה — מוח המכירות מחליט מה נאמר, ואם הוא סבור שעדיף לא לדבר בסבב הזה הליד פשוט מדולג בלי לשרוף ניסיון. הוויתור אחרי מספר הניסיונות שהגדרת ממשיך לעבוד כרגיל.",
    where: "בכל תזכורת, לפני השליחה",
    type: "toggle",
  },
  {
    key: "setterModel",
    group: "מוח מכירות",
    label: "המודל שכותב",
    description:
      "המודל שמנסח את הודעות הסטר. חזק יותר = עברית טבעית יותר, יקר יותר לקריאה. הניתוח (סיווג המצב) רץ על מודל השיחה הזול מקבוצת המודלים.",
    type: "select",
    options: MODEL_OPTIONS,
  },
  {
    key: "setterMaxWords",
    group: "מוח מכירות",
    label: "אורך מקסימלי להודעה",
    description:
      "תקרת מילים קשיחה — הודעה ארוכה יותר נפסלת בולידציה ונכתבת מחדש. המנסח מכוון לשני-שליש מהתקרה.",
    type: "number",
    min: 25,
    max: 100,
    unit: "מילים",
  },
  {
    key: "setterStyle",
    group: "מוח מכירות",
    label: "סגנון הכתיבה",
    description:
      "כללי הטון שהמנסח מקבל בכל הודעה. זה המקום לכוון את ה'קול' — ישיר יותר, רך יותר, עם/בלי אימוג'י. חוקי הכסף (בלי מחירים מומצאים, בלי הנחות) נאכפים בנפרד ואי אפשר לבטל אותם מכאן.",
    type: "longtext",
  },
  {
    key: "setterGoneQuietHours",
    group: "מוח מכירות",
    label: "אחרי כמה שעות שקט הלקוח נחשב 'נעלם'",
    description:
      "כשאנחנו דיברנו אחרונים והלקוח שותק מעל הסף — הסטר עובר למצב החייאה (עיגון בהצעה + הצעת שיחה) בלי לשאול מודל. סף נמוך = החייאה מוקדמת ואגרסיבית יותר.",
    type: "number",
    min: 2,
    max: 72,
    unit: "שעות",
  },
  {
    key: "skillAppointmentBooking",
    group: "טקטיקות המכירה",
    label: "קביעת שיחה",
    description: "ההנחיה המרכזית של הסטר — איך מציעים שיחה: חלונות קונקרטיים, מסגור קליל, מה להכין.",
    where: "בכל יעד של קביעת שיחה — לקוח חם, בקשת שיחה, החייאה",
    type: "longtext",
  },
  {
    key: "skillObjectionPriceAer",
    group: "טקטיקות המכירה",
    label: "התנגדות מחיר (הכר-חקור-כוון)",
    description: "הטיפול ב'יקר לי': להכיר ברגש, לברר בשאלה אחת מה מאחורי ההתנגדות, ולכוון לפתרון בטלפון. בלי הצדקות מחיר ובלי הנחות.",
    where: "כשהלקוח מתנגד על מחיר או משווה למתחרה",
    type: "longtext",
  },
  {
    key: "skillObjectionExplore",
    group: "טקטיקות המכירה",
    label: "חקירת התנגדות כללית",
    description: "התנגדות שאינה מחיר (תזמון, אישור, אמון) — איך מבררים אותה בשאלה מכבדת אחת.",
    where: "התנגדות לא-מחירית או לא ברורה",
    type: "longtext",
  },
  {
    key: "skillGhostRecovery",
    group: "טקטיקות המכירה",
    label: "החייאת לקוח שנעלם",
    description: "ההודעה ללקוח שקיבל הצעה ושתק: עיגון בהצעה הספציפית, ערך אחד, הצעת שיחה. בלי 'רק מוודא שקיבלת'.",
    where: "לקוח ששתק אחרי הצעה",
    type: "longtext",
  },
  {
    key: "skillCallbackScheduling",
    group: "טקטיקות המכירה",
    label: "קיבוע דחייה לזמן",
    description: "מה עושים עם 'דבר איתי שבוע הבא' — מקבלים, ומקבעים לתאריך ושעה.",
    where: "כשהלקוח דוחה למועד עתידי",
    type: "longtext",
  },
  {
    key: "skillBuyingSignal",
    group: "טקטיקות המכירה",
    label: "הגברת סימן קנייה",
    description: "איך מתרגמים רגע של עניין ('נשמע טוב', שאלה עניינית) לצעד קדימה במקום לעוד מידע.",
    where: "לקוח ששידר עניין",
    type: "longtext",
  },
  {
    key: "skillMicroCommitment",
    group: "טקטיקות המכירה",
    label: "התחייבות קטנה",
    description: "הצעד הקטן שמבקשים מלקוח מהוסס לפני שמבקשים שיחה.",
    where: "לקוח פושר או אחרי בירור התנגדות",
    type: "longtext",
  },
  {
    key: "skillFlowManagement",
    group: "טקטיקות המכירה",
    label: "ניהול זרימה",
    description: "הכלל הבסיסי של כל תשובה: לענות קצר על מה שנשאל ולקדם צעד אחד, בלי להשאיר את הכדור באוויר.",
    where: "כל שאלה של לקוח",
    type: "longtext",
  },
  {
    key: "skillFollowUpDiscipline",
    group: "טקטיקות המכירה",
    label: "משמעת פולו-אפ",
    description: "החוקים של הודעת מעקב: אזכור ההצעה, דבר אחד חדש, צעד אחד, קצר.",
    where: "הודעות מעקב",
    type: "longtext",
  },
  {
    key: "skillPauseIntelligence",
    group: "טקטיקות המכירה",
    label: "מתי לא לדחוף",
    description: "הבלם: מתי הפעולה הנכונה היא לענות ולחכות במקום לדחוף לשיחה.",
    where: "לקוח מהוסס או אחרי דחיפה קודמת",
    type: "longtext",
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
  {
    key: "transcribeProvider",
    group: "מודלים",
    label: "מי מתמלל את השיחות",
    description:
      "**הפרדת דוברים קיימת רק אצל ElevenLabs.** אף מודל תמלול של OpenAI לא יודע להפריד בין מי שמדבר, אז שיחת מכירה חוזרת כגוש טקסט אחד ומי שמנתח אותה צריך לנחש מי התנגד ומי הבטיח.\n\nElevenLabs מחזיר תמלול מסומן — \"דובר 1 / דובר 2\" — וגם מקבל קבצים גדולים בהרבה, מה שפותר שיחות ארוכות שהיום נופלות בגלל מגבלת הגודל. משתמש במפתח שכבר קיים אצלך לסוכן הקולי.\n\nאם ElevenLabs נכשל מסיבה כלשהי — התמלול חוזר אוטומטית ל-OpenAI. עדיף תמלול בלי שמות דוברים מאשר בלי תמלול.",
    where: "כל שיחת טלפון שנענתה",
    type: "select",
    options: [
      { value: "openai", label: "OpenAI — בלי הפרדת דוברים (ברירת מחדל)" },
      { value: "elevenlabs", label: "ElevenLabs Scribe — עם הפרדת דוברים" },
    ],
  },
  {
    key: "transcribeModel",
    group: "מודלים",
    label: "מודל תמלול שיחות",
    description:
      "רלוונטי רק כשהמתמלל הוא OpenAI. whisper-1 הוא הוותיק והזול; דגמי gpt-4o מזהים עברית מדויק יותר ועולים יותר. **אף אחד מהם לא מפריד בין דוברים** — לזה צריך את ההגדרה שמעל.",
    where: "כל שיחת טלפון שנענתה",
    type: "select",
    options: [
      { value: "whisper-1", label: "whisper-1 — ותיק וזול (ברירת מחדל)" },
      { value: "gpt-4o-mini-transcribe", label: "gpt-4o-mini-transcribe — מדויק יותר" },
      { value: "gpt-4o-transcribe", label: "gpt-4o-transcribe — הכי מדויק, הכי יקר" },
    ],
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
