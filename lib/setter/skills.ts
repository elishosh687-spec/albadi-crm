/**
 * Setter layer — the sales skills.
 *
 * Each skill is a compact Hebrew tactic block the generator receives verbatim.
 * Written by us for OUR sale (B2B branded bags, ₪5k-50k, WhatsApp, the goal is
 * a booked call — never closing in chat). Methodology-inspired by public sales
 * playbooks; the text is original, so there is no license exposure.
 *
 * Deliberately TS constants, not files-on-disk and not a vector store: the
 * router picks 1-3 by deterministic rules, and at this corpus size retrieval
 * infrastructure would add latency without adding information.
 */

export type SkillId =
  | "appointment_booking"
  | "buying_signal_amplification"
  | "objection_explore"
  | "objection_price_aer"
  | "micro_commitment"
  | "ghost_recovery"
  | "callback_scheduling"
  | "flow_management"
  | "follow_up_discipline"
  | "pause_intelligence";

export const SKILLS: Record<SkillId, { title: string; guidance: string }> = {
  appointment_booking: {
    title: "קביעת שיחה",
    guidance:
      "היעד: שיחת טלפון בזמן מוגדר, לא 'נדבר מתישהו'. " +
      "הצע חלון קונקרטי אחד או שניים (למשל 'היום ב-17:00 או מחר ב-11:00') — אף פעם לא 'מתי נוח לך?' פתוח, זה מעביר את כל העבודה ללקוח. " +
      "אם חסר ללקוח מידע לשיחה (מידות/לוגו/כמות) — אמור בקצרה מה כדאי שיהיה מולו, כדי שהשיחה תהיה שווה לשני הצדדים. " +
      "מסגר את השיחה כקצרה וקלה: 'שיחה של 10 דקות'. אל תציג אותה כ'פגישה' כבדה.",
  },
  buying_signal_amplification: {
    title: "הגברת סימן קנייה",
    guidance:
      "הלקוח שידר עניין (שאל שאלה עניינית, אמר 'נשמע טוב', התעניין בזמנים). אל תבזבז את הרגע על עוד מידע — תרגם אותו לצעד. " +
      "אשר בקצרה את מה ששאל, ואז חבר ישירות להצעת שיחה: הרגע שבו לקוח שואל 'כמה זמן משלוח?' הוא הרגע להציע לסגור פרטים בטלפון. " +
      "אל תוסיף פרטים שלא ביקש — כל פסקת מידע נוספת מרחיקה את ההחלטה.",
  },
  objection_explore: {
    title: "חקירת התנגדות",
    guidance:
      "לפני שעונים על התנגדות — מבינים אותה. 'יקר לי' יכול להיות: מחיר מוחלט, השוואה למתחרה, תזרים, תזמון, חוסר ודאות במוצר, או דחייה מנומסת. " +
      "שאל שאלה אחת קצרה ומכבדת שמבררת איזו מהן זו ('יקר ביחס להצעה אחרת שקיבלתם, או ביחס לתקציב?'). " +
      "אל תצדיק את המחיר ואל תציע הנחה לפני שהבנת מה באמת עומד מאחורי ההתנגדות.",
  },
  objection_price_aer: {
    title: "טיפול בהתנגדות מחיר (הכר-חקור-כוון)",
    guidance:
      "שלב 1 — הכר: תן ללקוח להרגיש שנשמע, בלי להתגונן ('מבין לגמרי, זו החלטה כספית'). " +
      "שלב 2 — חקור: שאלה אחת שמבררת את מקור ההתנגדות (מתחרה? תקציב? כמות?). " +
      "שלב 3 — כוון: אל פתרון בטלפון, לא אל ויכוח בצ'אט. מחיר, כמויות וחלופות זה בדיוק מה שנסגר בשיחה קצרה. " +
      "לעולם אל תציע הנחה או מחיר חדש בצ'אט — אין לך סמכות להמציא מספרים.",
  },
  micro_commitment: {
    title: "התחייבות קטנה",
    guidance:
      "אל תבקש את הצעד הגדול כשהלקוח מהוסס — בקש צעד קטן שקל להגיד לו כן: 'לשלוח לך דוגמאות מעבודות דומות?', 'אשלח סיכום קצר של ההצעה?', 'נוח לך שנציץ יחד על הלוגו בשיחה קצרה?'. " +
      "כל כן קטן מקרב לשיחה. אחרי כן אחד — הצע את השיחה עצמה.",
  },
  ghost_recovery: {
    title: "החייאת ליד ששתק",
    guidance:
      "הלקוח קיבל הצעה ונעלם. אל תשאל 'ראית את ההצעה?' ואל תאשים. " +
      "עגן את ההודעה בהצעה הספציפית (הכמות או המחיר) כדי להראות שזו לא תבנית, תן פיסת ערך או צעד קל אחד, וסיים בהצעת שיחה בזמן קונקרטי. " +
      "הודעה אחת, קצרה. לא סדרת נודניקים באותה הודעה, ולא 'רק מוודא שקיבלת'.",
  },
  callback_scheduling: {
    title: "קיבוע דחייה לזמן",
    guidance:
      "כשלקוח אומר 'דבר איתי שבוע הבא' / 'אחרי החג' — זו הסכמה, אל תתווכח איתה. קבע אותה: הפוך את הדחייה לזמן מוגדר ('סגור. יום שני ב-11:00 טוב?'). " +
      "דחייה בלי תאריך היא דחייה לנצח; דחייה עם תאריך היא פגישה. " +
      "אשר בקצרה מה יהיה בשיחה כדי שיגיע מוכן.",
  },
  flow_management: {
    title: "ניהול זרימה",
    guidance:
      "ענה על מה שהלקוח שאל — קצר וישיר — ואז קדם את השיחה צעד אחד. אל תשאיר את הכדור באוויר: כל הודעה מסתיימת בשאלה אחת או הצעה אחת. " +
      "רעיון אחד להודעה. אם יש שני דברים להגיד — ההודעה ארוכה מדי.",
  },
  follow_up_discipline: {
    title: "משמעת פולו-אפ",
    guidance:
      "פולו-אפ טוב: מאזכר את ההצעה הספציפית, מוסיף דבר אחד חדש (לא חוזר על מה שנאמר), מציע צעד אחד ברור, ונגמר. עד 40 מילים. " +
      "בלי 'רק רציתי לוודא', בלי 'מזכיר לך', בלי סימני לחץ מלאכותיים. הלקוח יודע שקיבל הצעה — תן לו סיבה לחזור, לא נזיפה.",
  },
  pause_intelligence: {
    title: "מתי לא לדחוף",
    guidance:
      "לא כל הודעה דוחפת לשיחה. אם הלקוח באמצע למסור פרטים, אם הרגע ענה ומחכה לתשובה עניינית, או אם הביע רתיעה — הפעולה הנכונה היא לענות, לתת מקום, ולחכות. " +
      "דחיפה לשיחה פעמיים ברצף אחרי היסוס נקראת לחץ. עדיף צעד קטן (ראה התחייבות קטנה) או שתיקה מכבדת.",
  },
};

/** Which BotSettings field overrides each skill's guidance. The settings
 *  screen is the live source; these constants are the defaults + fallback. */
export const SKILL_SETTING_KEY: Record<SkillId, string> = {
  appointment_booking: "skillAppointmentBooking",
  buying_signal_amplification: "skillBuyingSignal",
  objection_explore: "skillObjectionExplore",
  objection_price_aer: "skillObjectionPriceAer",
  micro_commitment: "skillMicroCommitment",
  ghost_recovery: "skillGhostRecovery",
  callback_scheduling: "skillCallbackScheduling",
  flow_management: "skillFlowManagement",
  follow_up_discipline: "skillFollowUpDiscipline",
  pause_intelligence: "skillPauseIntelligence",
};
