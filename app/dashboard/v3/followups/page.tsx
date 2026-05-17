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

// Cadence rules — MUST match app/api/bot/followups/route.ts STAGE_RULES.
const CADENCE_BY_STAGE: Record<string, number[]> = {
  NEW: [1 * HOUR_MS, 1 * HOUR_MS, 1 * HOUR_MS],
  AWAITING_ESTIMATE: [2 * HOUR_MS, 12 * HOUR_MS, 23 * HOUR_MS],
  AWAITING_LOGO: [2 * HOUR_MS, 12 * HOUR_MS, 23 * HOUR_MS],
  AWAITING_FINAL: [2 * HOUR_MS, 12 * HOUR_MS, 23 * HOUR_MS],
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
    if (stage === "WON" || stage === "DROPPED") continue;
    // Skip stages that don't have customer-side follow-ups.
    if (stage === "WAITING_FACTORY") continue;

    // Pick cadence — NEW also requires q_state mid-flight (matches cron logic).
    let cadences: number[] | null = null;
    if (!stage || stage === "NEW") {
      const q = r.qState as any;
      if (!q || q.bailed || q.doneAt) continue;
      if (typeof q.step !== "number" || q.step < 2 || q.step > 7) continue;
      cadences = CADENCE_BY_STAGE.NEW;
    } else if (CADENCE_BY_STAGE[stage]) {
      cadences = CADENCE_BY_STAGE[stage];
    }
    if (!cadences) continue;

    const attempt = r.followUpCount ?? 0; // 0-based count of attempts already sent
    if (attempt >= MAX_FOLLOWUPS) continue; // will escalate, not nudge

    const cadenceIdx = Math.min(attempt, cadences.length - 1);
    const waitMs = cadences[cadenceIdx];
    const lastTs = r.lastFollowUpAt?.getTime() ?? now; // if never sent, treat as "now" → eligible immediately
    const nextEligibleAt = new Date(lastTs + waitMs);
    const hoursUntil = (nextEligibleAt.getTime() - now) / HOUR_MS;

    queue.push({
      sid: r.sid,
      name: r.name,
      phone: r.phone,
      stage: stage || "NEW",
      attemptNext: attempt + 1, // human-readable: "attempt 1" not "0"
      lastFollowUpAt: r.lastFollowUpAt,
      nextEligibleAt,
      hoursUntil,
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
          <Link
            href={`/dashboard/v3?lead=${encodeURIComponent(q.sid)}`}
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
