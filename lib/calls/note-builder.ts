import type { BotSettings } from "../bot-settings/schema";
import type { CallAnalysisV2 } from "./analysis-v2";

function bullets(values: string[]): string {
  return values.length ? values.map((value) => `• ${value}`).join("\n") : "—";
}

function yesNoUnknown(value: boolean | null): string {
  return value === true ? "כן" : value === false ? "לא" : "לא ידוע";
}

function enabledSections(settings: BotSettings): Set<string> {
  return new Set(
    settings.callAnalysisNoteSections
      .split(",")
      .map((section) => section.trim())
      .filter(Boolean),
  );
}

export function buildCallAnalysisNote(args: {
  marker: string;
  sourceLabel: string;
  startedAt: Date | null;
  durationSec: number | null;
  direction?: string | null;
  analysis: CallAnalysisV2;
  transcript: string;
  settings: BotSettings;
}): string {
  const { analysis, settings } = args;
  const sections = enabledSections(settings);
  const date = args.startedAt
    ? args.startedAt.toLocaleString("he-IL", {
        timeZone: "Asia/Jerusalem",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
  const duration = args.durationSec ? `${Math.max(1, Math.round(args.durationSec / 60))} דק׳` : "—";
  const direction =
    args.direction === "inbound" ? "נכנסת" : args.direction === "outbound" ? "יוצאת" : null;
  const lines = [
    args.marker,
    `📞 ${args.sourceLabel}: ${date} · ${duration}${direction ? ` · ${direction}` : ""}`,
    `גרסת ניתוח: ${analysis.schema_version}`,
  ];

  if (sections.has("summary")) {
    lines.push("", `🧭 סיכום: ${analysis.call_summary || "—"}`);
  }
  if (sections.has("needs")) {
    const needs = analysis.needs.length
      ? analysis.needs.map((need) => need.need)
      : analysis.customer_needs;
    lines.push("", "🎯 צרכים:", bullets(needs));
  }
  if (sections.has("specification")) {
    const spec = analysis.specification;
    lines.push(
      "",
      "🛍️ מפרט ובשלות:",
      `• כמות: ${spec.quantity?.toLocaleString("he-IL") ?? "לא ידוע"}`,
      `• מידה: ${spec.size ?? "לא ידוע"}`,
      `• צבעים: ${spec.colors ?? "לא ידוע"}`,
      `• מפרט אושר: ${yesNoUnknown(spec.approved)}`,
      `• לוגו נשלח: ${yesNoUnknown(spec.logoSent)}`,
      spec.missing.length ? `• חסר: ${spec.missing.join(", ")}` : "",
    );
  }
  if (sections.has("objections")) {
    const objections = analysis.objectionsV2.length
      ? analysis.objectionsV2.map((objection) =>
          objection.evidence.validation === "valid" && objection.evidence.quote
            ? `${objection.customerWording} (״${objection.evidence.quote}״)`
            : objection.customerWording,
        )
      : analysis.objections.map((objection) =>
          objection.quote ? `${objection.text} (״${objection.quote}״)` : objection.text,
        );
    lines.push("", "⚠️ התנגדויות:", bullets(objections));
  }
  if (sections.has("outcome")) {
    lines.push(
      "",
      `🏁 תוצאה: ${analysis.outcome.result || "לא ידוע"}`,
      `התקדמות: ${analysis.outcome.advance ?? "—"}`,
    );
  }
  if (sections.has("action")) {
    const action = analysis.outcome.proposedAction;
    lines.push(
      "",
      "➡️ פעולה מוצעת:",
      action
        ? `• ${action.description}\n• אחראי: ${action.responsibleParty}\n• מועד: ${action.dueAt ?? action.dueText ?? "לא נקבע"}\n• ביטחון: ${Math.round(action.confidence * 100)}%`
        : "—",
    );
  }
  if (sections.has("status")) {
    const status = analysis.outcome.statusRecommendation;
    lines.push(
      "",
      `🏷️ המלצת סטטוס: ${status ? `${status.status} — ${status.reason}` : "ללא שינוי"}`,
    );
  }
  if (sections.has("score") && settings.callAnalysisIncludeScore) {
    lines.push(
      "",
      `📈 ציון שיחת מכירה: ${analysis.salespersonExecution.scoreOutOf10 ?? "לא ניתן"}/10`,
      bullets(analysis.salespersonExecution.learningNotes),
    );
  }
  if (settings.callAnalysisIncludeTranscript) {
    lines.push("", "📄 תמלול:", args.transcript || "—");
  }
  return lines.filter((line) => line !== "").join("\n");
}
