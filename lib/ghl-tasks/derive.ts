/**
 * Pure function: given a lead snapshot + its open signal rows, compute the
 * canonical set of GHL Contact Tasks that should currently exist for it.
 *
 * Tasks are identified by `signal_kind` — a stable string key. The
 * reconciler in lib/ghl-tasks/reconcile.ts diffs this set against the
 * `ghl_lead_tasks` cache to issue create/update/delete calls to GHL.
 *
 * Mirror of the scoring logic in
 * app/dashboard/v3/_components/crm-insights.ts so Eli sees the same
 * signals surface in both the dashboard CommandCenter and the GHL Tasks
 * tab.
 */

export type SignalKind =
  | "needs_eli_escalation"
  | "bot_paused"
  | "draft_pending"
  | "factory_received"
  | "factory_stuck"
  | "big_quote_close"
  | "idle_active_lead";

export interface DesiredTask {
  signalKind: SignalKind;
  title: string;
  dueAt: Date;
}

export interface LeadSignalSnapshot {
  sid: string;
  pipelineStage: string | null;
  pipelineFlag: string | null;
  botPaused: boolean;
  quoteTotal: string | null;
  lastResponseAt: Date | null;
  updatedAt: Date | null;
  qState: Record<string, unknown> | null;

  // Aggregated signals
  pendingDraftCount: number;
  pendingDraftEarliest: Date | null;
  factoryReceivedCount: number;
}

const ACTIVE_STAGES = new Set([
  "INITIAL_QUOTE_SENT",
  "AWAITING_FIRST_RESPONSE",
  "SHOWED_INTEREST",
  "NEGOTIATING",
]);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function deriveDesiredTasks(
  lead: LeadSignalSnapshot,
  now: Date = new Date()
): DesiredTask[] {
  const tasks: DesiredTask[] = [];

  // 1. Explicit escalation flag.
  if (lead.pipelineFlag === "NEEDS_ELI") {
    tasks.push({
      signalKind: "needs_eli_escalation",
      title: "🔴 טפל באסקלציה",
      dueAt: now,
    });
  }

  // 2. Bot paused — Eli must reply manually.
  if (lead.botPaused) {
    tasks.push({
      signalKind: "bot_paused",
      title: "⏸ בוט מושהה — ענה ידנית",
      dueAt: now,
    });
  }

  // 3. Pending draft awaiting approval.
  if (lead.pendingDraftCount > 0) {
    const base = lead.pendingDraftEarliest ?? now;
    tasks.push({
      signalKind: "draft_pending",
      title: "💰 אשר/דחה טיוטה",
      dueAt: new Date(base.getTime() + HOUR_MS),
    });
  }

  // 4. Factory replied — Eli needs to price.
  if (lead.factoryReceivedCount > 0) {
    tasks.push({
      signalKind: "factory_received",
      title: "🏭 תמחר הצעת מפעל",
      dueAt: new Date(now.getTime() + DAY_MS),
    });
  }

  // 5. Factory stuck >3 days — waiting on factory estimate.
  const subFlow = (lead.qState as { subFlow?: string } | null)?.subFlow;
  if (
    lead.pipelineStage === "FACTORY_CHECK" &&
    subFlow === "awaiting_factory_estimate" &&
    lead.updatedAt &&
    now.getTime() - lead.updatedAt.getTime() >= 3 * DAY_MS
  ) {
    tasks.push({
      signalKind: "factory_stuck",
      title: "⏰ פנה למפעל — חיכינו 3+ ימים",
      dueAt: now,
    });
  }

  // 6. Big quote sitting at FINAL_QUOTE_SENT — close it.
  const quoteTotalNum = lead.quoteTotal ? Number(lead.quoteTotal) : 0;
  if (
    lead.pipelineStage === "FINAL_QUOTE_SENT" &&
    quoteTotalNum >= 10_000
  ) {
    tasks.push({
      signalKind: "big_quote_close",
      title: "💎 סגור עסקה גדולה",
      dueAt: new Date(now.getTime() + DAY_MS),
    });
  }

  // 7. Idle active lead — no response in 48h, bot still on.
  if (
    !lead.botPaused &&
    lead.pipelineStage &&
    ACTIVE_STAGES.has(lead.pipelineStage) &&
    lead.lastResponseAt &&
    now.getTime() - lead.lastResponseAt.getTime() >= 2 * DAY_MS
  ) {
    tasks.push({
      signalKind: "idle_active_lead",
      title: "📞 פעולה אחרונה לפני קר",
      dueAt: now,
    });
  }

  return tasks;
}

/**
 * Did this snapshot surface any "Eli must act" signal at all? Drives the
 * `eli_action` vs `bot_active` ownership tag.
 */
export function eliMustAct(lead: LeadSignalSnapshot, now?: Date): boolean {
  return deriveDesiredTasks(lead, now).length > 0;
}
