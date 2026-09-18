/**
 * Hebrew display names for raw analytics keys (lead_source values, pipeline
 * stages incl. legacy/side stages). ui-ux-pro-max: no technical keys on screen.
 * Client-safe.
 */
import { LEGACY_STAGE_MAP, V2_STAGE_LABELS, type V2AssignableStage } from "@/lib/manychat/stages";

const SOURCE_LABELS: Record<string, string> = {
  facebook: "מודעות פייסבוק",
  fb_form: "טופס פייסבוק",
  greenapi_webhook: "וואטסאפ ישיר",
  whatsapp: "וואטסאפ ישיר",
  ghl_sync: "סנכרון מ-GHL",
  manychat_webhook: "ManyChat (ישן)",
  quote_reassign: "הצעה שהועברה",
  website: "האתר",
  website_configurator: "מחשבון באתר",
  manual: "הוזן ידנית",
};

export function sourceLabel(raw: string | null | undefined): string {
  const k = (raw ?? "").trim();
  if (!k) return "לא ידוע";
  return SOURCE_LABELS[k.toLowerCase()] ?? k;
}

/** Stage key (current, side, legacy or UNCLASSIFIED) → Eli's stage word. */
export function stageLabel(raw: string | null | undefined): string {
  const k = (raw ?? "").trim().toUpperCase();
  if (!k || k === "UNCLASSIFIED" || k === "NULL") return "בלי שלב (בשאלון)";
  if (k in V2_STAGE_LABELS) return V2_STAGE_LABELS[k as V2AssignableStage];
  const mapped = LEGACY_STAGE_MAP[k];
  if (mapped) return V2_STAGE_LABELS[mapped];
  if (mapped === null) return "בלי שלב (בשאלון)";
  return k;
}

/** Merge rows whose keys share one display label (legacy + current stage). */
export function groupByLabel<T extends { count: number }>(
  rows: T[],
  label: (row: T) => string,
): { label: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of rows) m.set(label(r), (m.get(label(r)) ?? 0) + r.count);
  return [...m].map(([l, count]) => ({ label: l, count })).sort((a, b) => b.count - a.count);
}
