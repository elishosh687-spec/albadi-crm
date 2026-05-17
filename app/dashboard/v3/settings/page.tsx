import { db } from "@/lib/db";
import { botConfig } from "@/drizzle/schema";
import { SettingsForm, type SettingItem } from "./SettingsForm";
import { FactoryPricingForm } from "./FactoryPricingForm";
import { TemplatesSection } from "./TemplatesSection";
import { getFactoryConfig } from "@/lib/factory/config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PROMPT_KEYS: Array<{
  key: string;
  label: string;
  hint: string;
  rows?: number;
  fallback?: string;
}> = [
  {
    key: "prompt.intent_system",
    label: "Intent classifier — system prompt",
    hint: "ה-LLM שמסווג כוונה של הודעה נכנסת (accept / reject / negotiating / question_*).",
    rows: 8,
  },
  {
    key: "prompt.suggest_reply_system",
    label: "Suggest-reply — system prompt",
    hint: "ה-LLM שמייצר 3 הצעות תגובה ל-Eli על לידים שעברו אסקלציה.",
    rows: 10,
  },
  {
    key: "prompt.money_draft_system",
    label: "Money-draft — system prompt",
    hint: "ה-LLM שמייצר טיוטה אחת ל-Eli על רגעי כסף (הצעת מחיר, הנחה, משא ומתן).",
    rows: 10,
  },
  {
    key: "voice.first_person",
    label: "Voice — first person",
    hint: "האם הבוט כותב בגוף ראשון יחיד? (true/false)",
    rows: 1,
  },
  {
    key: "money.threshold_ils",
    label: "Money threshold (₪)",
    hint: "מעל איזה סכום ההתערבות נחשבת money-moment אוטומטי (מספר).",
    rows: 1,
  },
];

const SECTION_LABELS = {
  flags: "Feature Flags",
  prompts: "Bot Prompts & Voice",
  pipeline: "Pipeline & Drag-drop",
};

export default async function V3SettingsPage() {
  const [rows, factoryConfig] = await Promise.all([
    db.select().from(botConfig),
    getFactoryConfig(),
  ]);
  const byKey = new Map(rows.map((r) => [r.key, r.value ?? ""]));

  const flags: SettingItem[] = [
    {
      key: "ENABLE_DRAFT_QUEUE",
      label: "ENABLE_DRAFT_QUEUE",
      hint:
        "כשמופעל (1), מקרי כסף (negotiating / reject / spec_change) יוצרים draft ב-bot_drafts לאישור.",
      value: process.env.ENABLE_DRAFT_QUEUE ?? "",
      type: "readonly-env",
    },
    {
      key: "USE_BRIDGE",
      label: "USE_BRIDGE",
      hint:
        "כשמופעל (1), כל messaging הולך דרך whatsapp-bridge-node במקום ManyChat.",
      value: process.env.USE_BRIDGE ?? "",
      type: "readonly-env",
    },
    {
      key: "BRIDGE_DRY_RUN",
      label: "BRIDGE_DRY_RUN",
      hint:
        "אם 1 — שליחת WhatsApp מודמה ולא יוצאת באמת. השאר 0/ריק ב-prod.",
      value: process.env.BRIDGE_DRY_RUN ?? "",
      type: "readonly-env",
    },
  ];

  const prompts: SettingItem[] = PROMPT_KEYS.map((p) => ({
    key: p.key,
    label: p.label,
    hint: p.hint,
    value: byKey.get(p.key) ?? "",
    type: "editable-textarea",
    rows: p.rows ?? 4,
  }));

  const pipeline: SettingItem[] = [
    {
      key: "pipeline.confirm_drag",
      label: "אישור לפני מעבר stage ב-Pipeline (kanban)",
      hint: "true = שואל לפני שמעביר ליד בין עמודות. false = מיד עם undo toast.",
      value: byKey.get("pipeline.confirm_drag") ?? "true",
      type: "editable-bool",
    },
    {
      key: "pipeline.allow_drag",
      label: "אפשר drag-drop בכלל",
      hint: "false = Pipeline read-only, השינויים נעשים רק מה-drawer.",
      value: byKey.get("pipeline.allow_drag") ?? "true",
      type: "editable-bool",
    },
  ];

  return (
    <div className="flex flex-col gap-8 max-w-3xl">
      <SettingsForm
        sections={[
          { id: "flags", label: SECTION_LABELS.flags, items: flags },
          { id: "prompts", label: SECTION_LABELS.prompts, items: prompts },
          { id: "pipeline", label: SECTION_LABELS.pipeline, items: pipeline },
        ]}
      />
      <FactoryPricingForm initial={factoryConfig} />
      <TemplatesSection />
    </div>
  );
}
