export const BOT_FUNNEL_DEFINITIONS = [
  ["questionnaire_started", "התחיל שאלון"],
  ["quantity_answered", "ענה על כמות"],
  ["size_answered", "בחר מידה"],
  ["colors_answered", "ענה על מספר צבעים"],
  ["spec_confirmed", "אישר מפרט"],
  ["quote_sent", "קיבל מחיר"],
  ["post_quote_reply", "הגיב אחרי המחיר"],
  ["call_booked", "קבע שיחה"],
  ["conversation_held", "התקיימה שיחה"],
  ["qualified_ready", "ליד מתאים ומוכן"],
  ["first_payment_received", "התקבל תשלום ראשון"],
] as const;

const EVENT_ALIASES: Partial<Record<(typeof BOT_FUNNEL_DEFINITIONS)[number][0], string[]>> = {
  size_answered: ["size_selected"],
  post_quote_reply: ["quote_replied"],
  conversation_held: ["call_completed"],
};

export type BotFunnelRow = {
  event: string;
  label: string;
  attempts: number;
  uniqueLeads: number;
};

export function buildBotFunnel(
  rows: Array<{ event: string; attempts: number; uniqueLeads: number }>
): BotFunnelRow[] {
  const byEvent = new Map(rows.map((row) => [row.event, row]));
  return BOT_FUNNEL_DEFINITIONS.map(([event, label]) => {
    const names = [event, ...(EVENT_ALIASES[event] ?? [])];
    return {
      event,
      label,
      attempts: names.reduce((sum, name) => sum + Number(byEvent.get(name)?.attempts ?? 0), 0),
      uniqueLeads: names.reduce(
        (sum, name) => sum + Number(byEvent.get(name)?.uniqueLeads ?? 0),
        0
      ),
    };
  });
}

export function percentage(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

export type CanonicalLossReason =
  | "PRICE"
  | "QUANTITY_TOO_HIGH"
  | "DELIVERY_TIME"
  | "NOT_READY"
  | "NO_RESPONSE"
  | "CHOSE_COMPETITOR"
  | "OTHER"
  | "UNRECORDED";

export function normalizeLossReason(value: string | null): CanonicalLossReason {
  if (value === "PRICE" || value === "יקר_לו") return "PRICE";
  if (value === "QUANTITY_TOO_HIGH" || value === "כמות") return "QUANTITY_TOO_HIGH";
  if (value === "DELIVERY_TIME" || value === "זמן_אספקה") return "DELIVERY_TIME";
  if (value === "NOT_READY") return "NOT_READY";
  if (value === "NO_RESPONSE" || value === "לא_ענה") return "NO_RESPONSE";
  if (value === "CHOSE_COMPETITOR" || value === "מצא_ספק_אחר") return "CHOSE_COMPETITOR";
  if (value === "OTHER" || value === "לא_רלוונטי" || value === "opt_out") return "OTHER";
  return "UNRECORDED";
}

export function aggregateLossReasons(
  rows: Array<{ key: string | null; count: number }>
): Array<{ key: CanonicalLossReason; count: number }> {
  const totals = new Map<CanonicalLossReason, number>();
  for (const row of rows) {
    const key = normalizeLossReason(row.key);
    totals.set(key, (totals.get(key) ?? 0) + Number(row.count ?? 0));
  }
  return [...totals.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

export function summarizeProfits(profits: number[]): {
  deals: number;
  averageProfitIls: number | null;
  medianProfitIls: number | null;
} {
  const valid = profits.filter(Number.isFinite).sort((a, b) => a - b);
  if (valid.length === 0) {
    return { deals: 0, averageProfitIls: null, medianProfitIls: null };
  }
  const middle = Math.floor(valid.length / 2);
  const median = valid.length % 2
    ? valid[middle]
    : (valid[middle - 1] + valid[middle]) / 2;
  return {
    deals: valid.length,
    averageProfitIls: valid.reduce((sum, value) => sum + value, 0) / valid.length,
    medianProfitIls: median,
  };
}
