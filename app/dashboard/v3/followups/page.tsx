import { db } from "@/lib/db";
import { leads, messages } from "@/drizzle/schema";
import { and, eq, isNull, or, desc, sql } from "drizzle-orm";
import { STAGE_LABEL, STAGE_TONE } from "../_components/stage-meta";
import Link from "next/link";
import { LayoutDashboard, Clock, Pause, AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

const HOUR_MS = 60 * 60 * 1000;
const MAX_FOLLOWUPS = 3;
const QUIET_START = 21; // 21:00 IL
const QUIET_END = 9;    // 09:00 IL

/** Hour-of-day in Asia/Jerusalem for a UTC Date. */
function jerusalemHour(d: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
    hour: "numeric",
    hour12: false,
  }).formatToParts(d);
  const hourPart = parts.find((p) => p.type === "hour");
  return hourPart ? Number(hourPart.value) : 0;
}

function isQuietAt(at: Date): boolean {
  const h = jerusalemHour(at);
  return h >= QUIET_START || h < QUIET_END;
}

/**
 * If `at` falls inside quiet hours (21:00-09:00 IL), advance to the next
 * minute-of-day where it's active. Brute-force 30-min steps — accurate
 * enough for display, no edge cases with DST or month boundaries.
 */
function adjustForQuietHours(at: Date): { adjusted: Date; deferred: boolean } {
  if (!isQuietAt(at)) return { adjusted: at, deferred: false };
  let candidate = new Date(at);
  // Advance until we hit an active hour. Bounded loop — max ~24 iterations of 30min.
  for (let i = 0; i < 50; i++) {
    candidate = new Date(candidate.getTime() + 30 * 60 * 1000);
    if (!isQuietAt(candidate)) {
      // Snap to the start of the active hour (round down to :00) for clean display.
      const h = jerusalemHour(candidate);
      if (h === QUIET_END) {
        // We're inside the first hour of active window. Use it as-is.
      }
      return { adjusted: candidate, deferred: true };
    }
  }
  return { adjusted: candidate, deferred: true };
}

// Cadence rules — MUST match app/api/bot/followups/route.ts STAGE_RULES.
// "PRE_QUOTE" is the sentinel for pipeline_stage IS NULL with active questionnaire.
const CADENCE_BY_STAGE: Record<string, number[]> = {
  PRE_QUOTE: [1 * HOUR_MS, 1 * HOUR_MS, 1 * HOUR_MS],
  INTAKE: [2 * HOUR_MS, 12 * HOUR_MS, 23 * HOUR_MS],
  FACTORY_WAIT: [2 * HOUR_MS, 12 * HOUR_MS, 23 * HOUR_MS],
  CONSIDERATION: [2 * HOUR_MS, 12 * HOUR_MS, 23 * HOUR_MS],
};

interface QueueRow {
  sid: string;
  name: string | null;
  phone: string | null;
  stage: string;
  attemptNext: number;
  lastFollowUpAt: Date | null;
  nextEligibleAt: Date;
  hoursUntil: number; // negative if already due
  deferredByQuietHours: boolean;
  botPaused: boolean;
  pipelineFlag: string | null;
  notes: string | null;
  lastInboundText: string | null;
  lastInboundAt: Date | null;
}

async function loadQueue(): Promise<QueueRow[]> {
  const rows = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      stage: leads.pipelineStage,
      qState: leads.qState,
      followUpCount: leads.followUpCount,
      lastFollowUpAt: leads.lastFollowUpAt,
      botPaused: leads.botPaused,
      pipelineFlag: leads.pipelineFlag,
      notes: leads.notes,
    })
    .from(leads)
    .where(eq(leads.active, true))
    .orderBy(desc(leads.updatedAt));

  // For each lead, predict the next-eligible time based on cadence.
  const sids = rows.map((r) => r.sid.trim());
  const lastInbounds =
    sids.length === 0
      ? []
      : await Promise.all(
          sids.map((sid) =>
            db
              .select({ text: messages.text, receivedAt: messages.receivedAt })
              .from(messages)
              .where(
                and(
                  sql`trim(${messages.manychatSubId}) = ${sid}`,
                  eq(messages.direction, "in")
                )
              )
              .orderBy(desc(messages.receivedAt))
              .limit(1)
              .then((r) => r[0] ?? null)
          )
        );

  const now = Date.now();
  const queue: QueueRow[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const stage = (r.stage ?? "").toUpperCase();

    // Skip terminal stages.
    if (stage === "WON" || stage === "LOST") continue;
    // FACTORY_WAIT split: Eli-only sub-flow has no customer-side follow-ups.
    const subFlow = (r.qState as any)?.subFlow;
    if (stage === "FACTORY_WAIT" && subFlow === "awaiting_factory_estimate") continue;

    // Pick cadence — pre-quote also requires q_state mid-flight (matches cron logic).
    let cadences: number[] | null = null;
    if (!stage) {
      const q = r.qState as any;
      if (!q || q.bailed || q.doneAt) continue;
      if (typeof q.step !== "number" || q.step < 2 || q.step > 7) continue;
      cadences = CADENCE_BY_STAGE.PRE_QUOTE;
    } else if (CADENCE_BY_STAGE[stage]) {
      cadences = CADENCE_BY_STAGE[stage];
    }
    if (!cadences) continue;

    const attempt = r.followUpCount ?? 0; // 0-based count of attempts already sent
    if (attempt >= MAX_FOLLOWUPS) continue; // will escalate, not nudge

    const cadenceIdx = Math.min(attempt, cadences.length - 1);
    const waitMs = cadences[cadenceIdx];
    const lastTs = r.lastFollowUpAt?.getTime() ?? now; // if never sent, treat as "now" → eligible immediately
    const rawNext = new Date(lastTs + waitMs);
    // Cron skips entirely during quiet hours (21:00–09:00 IL). Adjust the
    // displayed "next eligible" to the realistic send time.
    const { adjusted: nextEligibleAt, deferred: deferredByQuietHours } =
      adjustForQuietHours(rawNext);
    const hoursUntil = (nextEligibleAt.getTime() - now) / HOUR_MS;

    queue.push({
      sid: r.sid,
      name: r.name,
      phone: r.phone,
      stage: stage || "PRE_QUOTE",
      attemptNext: attempt + 1, // human-readable: "attempt 1" not "0"
      lastFollowUpAt: r.lastFollowUpAt,
      nextEligibleAt,
      hoursUntil,
      deferredByQuietHours,
      botPaused: r.botPaused ?? false,
      pipelineFlag: r.pipelineFlag,
      notes: r.notes,
      lastInboundText: lastInbounds[i]?.text ?? null,
      lastInboundAt: lastInbounds[i]?.receivedAt ?? null,
    });
  }

  queue.sort((a, b) => a.nextEligibleAt.getTime() - b.nextEligibleAt.getTime());
  return queue;
}

function formatHoursUntil(hours: number): string {
  if (hours < 0) {
    return `מאחר ב-${formatDuration(-hours)}`;
  }
  return `בעוד ${formatDuration(hours)}`;
}

function formatDuration(hours: number): string {
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return `${mins} דקות`;
  }
  if (hours < 24) {
    return `${hours.toFixed(1)} שעות`;
  }
  return `${(hours / 24).toFixed(1)} ימים`;
}

export default async function FollowupsQueuePage() {
  const queue = await loadQueue();

  const dueNow = queue.filter((q) => q.hoursUntil <= 0);
  const upcoming = queue.filter((q) => q.hoursUntil > 0);

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Clock className="size-6" />
          תור פולואפים
        </h1>
        <p className="text-sm text-muted-foreground">
          לידים שיקבלו follow-up מהסופרווייזר. הזמנים לפי שעון ישראל. הסופרווייזר עדיין יכול להחליט silence / escalate על כל אחד מהם.
        </p>
      </header>

      {/* Due now (cron should pick up on next tick) */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
          <AlertCircle className="size-4" />
          זמינים עכשיו ({dueNow.length})
        </h2>
        {dueNow.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card/30 p-6 text-center text-sm text-muted-foreground">
            אין follow-ups זמינים כרגע
          </div>
        ) : (
          <div className="grid gap-2">
            {dueNow.map((q) => (
              <QueueCard key={q.sid} q={q} />
            ))}
          </div>
        )}
      </section>

      {/* Upcoming */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
          <Clock className="size-4" />
          קרובים ({upcoming.length})
        </h2>
        {upcoming.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-card/30 p-6 text-center text-sm text-muted-foreground">
            אין follow-ups בהמתנה
          </div>
        ) : (
          <div className="grid gap-2">
            {upcoming.map((q) => (
              <QueueCard key={q.sid} q={q} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function QueueCard({ q }: { q: QueueRow }) {
  const tone = STAGE_TONE[q.stage] ?? STAGE_TONE.UNCLASSIFIED;
  const stageLabel = STAGE_LABEL[q.stage] ?? q.stage;
  const isDue = q.hoursUntil <= 0;

  return (
    <div
      className={`rounded-xl border bg-card p-3 ${
        isDue ? "border-amber-500/40" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${tone.pill}`}>
              {stageLabel}
            </span>
            <span className="text-xs text-muted-foreground font-mono">
              ניסיון {q.attemptNext}/{MAX_FOLLOWUPS}
            </span>
            {q.botPaused && (
              <span className="inline-flex items-center gap-0.5 text-xs text-yellow-500" title="בוט מושהה">
                <Pause className="size-3" />
                paused
              </span>
            )}
            {q.pipelineFlag === "NEEDS_ELI" && (
              <span className="text-xs text-red-400" title="דרוש טיפול">🔴 NEEDS_ELI</span>
            )}
          </div>
          <div className="font-semibold text-sm">{q.name ?? "ללא שם"}</div>
          {q.phone && (
            <div className="text-xs text-muted-foreground" dir="ltr">{q.phone}</div>
          )}
          {q.notes && (
            <div className="text-xs text-muted-foreground line-clamp-2">{q.notes}</div>
          )}
          {q.lastInboundText && (
            <div className="text-xs text-muted-foreground italic line-clamp-1">
              "{q.lastInboundText.slice(0, 100)}"
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 text-xs whitespace-nowrap">
          <div className={isDue ? "text-amber-600 font-medium" : "text-muted-foreground"}>
            {formatHoursUntil(q.hoursUntil)}
          </div>
          <div className="text-[10px] text-muted-foreground font-mono">
            {q.nextEligibleAt.toLocaleString("he-IL", {
              timeZone: "Asia/Jerusalem",
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}{" "}
            IL
          </div>
          {q.deferredByQuietHours && (
            <span
              className="text-[10px] rounded px-1.5 py-0.5 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30"
              title="הזמן המתמטי נפל בשעות שקט (21:00-09:00 IL). דחיתי ל-09:00."
            >
              דחוי משעות שקט
            </span>
          )}
          <Link
            href={`/dashboard/v3?lead=${encodeURIComponent(q.sid)}&from=followup`}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <LayoutDashboard className="size-3" />
            כרטיס
          </Link>
        </div>
      </div>
    </div>
  );
}
