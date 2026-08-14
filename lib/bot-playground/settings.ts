/**
 * Effective bot settings, as the running system actually sees them.
 *
 * This is a READ-ONLY mirror on purpose. Bot behaviour today lives in three
 * places — env flags, hardcoded constants, and the `factory_pricing` config —
 * and there is no single settings surface (the `bot_config` table exists but
 * nothing reads it). Showing the truth first means the playground can never
 * lie about what it is testing against.
 *
 * As each knob becomes editable it moves out of `readonly` and into a real
 * settings section; the shape here is the checklist of what still needs a home.
 */
import { getFactoryConfig } from "../factory/config";

export interface SettingItem {
  label: string;
  value: string;
  /** Where the value comes from — so it is obvious what can be changed today. */
  source: "env" | "code" | "config";
  hint?: string;
}

export interface SettingsGroup {
  title: string;
  items: SettingItem[];
}

function flag(name: string, on: boolean, onText = "פעיל", offText = "כבוי"): string {
  void name;
  return on ? onText : offText;
}

export async function loadEffectiveSettings(): Promise<SettingsGroup[]> {
  const cfg = await getFactoryConfig().catch(() => null);

  const messaging: SettingsGroup = {
    title: "ערוץ ההודעות",
    items: [
      {
        label: "ספק WhatsApp",
        value: process.env.USE_GREEN_API === "1" ? "GreenAPI" : "Bridge",
        source: "env",
        hint: "USE_GREEN_API",
      },
      {
        label: "סקרים (polls) בשאלון",
        value: flag("polls", true),
        source: "code",
        hint: "POLLS_ENABLED — כפתורים הוחלפו בסקרים",
      },
      {
        label: "שעות שקט",
        value: "21:00 – 09:00 (שעון ישראל)",
        source: "code",
        hint: "lib/clock/quiet-hours.ts",
      },
      {
        label: "חלון עבודה לתיאום שיחה",
        value: "א׳–ה׳ 09:00–21:00, מדלג חגים",
        source: "code",
        hint: "lib/clock/callback-window.ts",
      },
    ],
  };

  const behaviour: SettingsGroup = {
    title: "התנהגות הבוט",
    items: [
      {
        label: "תור טיוטות (רגעי כסף)",
        value: flag("drafts", process.env.ENABLE_DRAFT_QUEUE === "1"),
        source: "env",
        hint: "ENABLE_DRAFT_QUEUE",
      },
      {
        label: 'פלואו "מתי נוח לדבר"',
        value: flag("callback", process.env.CALLBACK_REQUESTS_ENABLED === "1"),
        source: "env",
        hint: "CALLBACK_REQUESTS_ENABLED — כבוי, וגם אין קרון שמפעיל",
      },
      {
        label: "סנכרון ל-GHL",
        value: flag("ghl", process.env.ENABLE_GHL_SYNC === "1"),
        source: "env",
        hint: "ENABLE_GHL_SYNC — לא רץ מהמגרש בכל מקרה",
      },
      {
        label: "ניסיונות לפני מעבר לטלפון",
        value: "3 תשובות לא מובנות",
        source: "code",
        hint: "unmatchedAt — ואז BAIL + DM לאלי",
      },
      {
        label: "כמות מינימלית להצעה אוטומטית",
        value: "3,000 יחידות",
        source: "code",
        hint: "מתחת לזה — ניתוב למפעל",
      },
      {
        label: "מידה מחוץ לקטלוג",
        value: "ניתוב למפעל (אין מחיר אוטומטי)",
        source: "code",
        hint: "shouldRouteToFactory — זו הדרישה שעומדת להשתנות",
      },
    ],
  };

  const pricing: SettingsGroup = {
    title: "תמחור",
    items: cfg
      ? [
          {
            label: "מע״מ",
            value: `${cfg.paymentTerms?.vatPct ?? 18}%`,
            source: "config",
            hint: "factory_pricing",
          },
          {
            label: "מרווח מיקוח",
            value:
              cfg.negotiationBufferAgorot && cfg.negotiationBufferAgorot > 0
                ? `${cfg.negotiationBufferAgorot} אג׳ לשקית`
                : "כבוי",
            source: "config",
          },
          {
            label: "רווח ברירת מחדל",
            value: `${cfg.defaultProfitMargin ?? 40}%`,
            source: "config",
          },
          {
            label: "עמלת מכירות",
            value: `${cfg.commissionPct ?? 10}%`,
            source: "config",
          },
          {
            label: "תנאי תשלום בהצעה האוטומטית",
            value: "לא נשלחים (ליד קר לא מקבל פרטי בנק)",
            source: "code",
          },
        ]
      : [
          {
            label: "קונפיג תמחור",
            value: "לא נטען",
            source: "config",
            hint: "getFactoryConfig נכשל — בדוק DATABASE_URL",
          },
        ],
  };

  const models: SettingsGroup = {
    title: "מודלים",
    items: [
      {
        label: "סיווג כוונות + חילוץ מפרט",
        value: process.env.OPENAI_MODEL || "gpt-4o-mini",
        source: "env",
        hint: "OPENAI_MODEL",
      },
      {
        label: "ניתוח ליד",
        value:
          process.env.LEAD_ANALYSIS_MODEL ||
          process.env.OPENAI_ANALYSIS_MODEL ||
          "gpt-4o",
        source: "env",
        hint: "LEAD_ANALYSIS_MODEL",
      },
      {
        label: "מפתח OpenAI",
        value: process.env.OPENAI_API_KEY ? "מוגדר" : "חסר — מסלולי LLM יידלגו",
        source: "env",
      },
    ],
  };

  return [messaging, behaviour, pricing, models];
}
