"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Banknote,
  Bot,
  Clock3,
  Factory,
  Inbox,
  MessageSquare,
  Pause,
  PhoneCall,
  Search,
  ShieldAlert,
  Sparkles,
  Users,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { LeadCardData } from "./LeadsBoard";
import {
  LIFECYCLE_LABEL,
  PRIORITY_LABEL,
  hasCallSignal,
  leadAgeHours,
  lifecycleOf,
  priorityOf,
  quoteNumber,
  type LifecycleKey,
  type PriorityBand,
} from "./crm-insights";
import { STAGE_LABEL, STAGE_TONE, timeAgoHe } from "./stage-meta";

export interface CommandCenterData {
  cards: LeadCardData[];
  pendingDrafts: number;
  pendingDraftSids: string[];
  factoryReceived: number;
  factoryReceivedSids: string[];
  crmTasks: Array<{
    id: number;
    sid: string;
    title: string;
    taskType: string;
    dueAt: string | null;
    status: string;
  }>;
  crmSla: Array<{
    id: number;
    sid: string;
    slaType: string;
    dueAt: string;
    breached: boolean;
  }>;
  latestScores: Array<{
    sid: string;
    scoreTotal: number;
    scoreBand: string;
    reason: string | null;
  }>;
}

interface QueueReason {
  key: string;
  label: string;
  tone: "danger" | "warning" | "success" | "info" | "muted";
  icon: typeof AlertCircle;
}

interface WorkQueueItem {
  card: LeadCardData;
  reasons: QueueReason[];
  score: number;
  nextAction: string;
}

const REASON_TONE: Record<QueueReason["tone"], string> = {
  danger: "border-rose-500/40 bg-rose-500/15 text-rose-200",
  warning: "border-amber-500/40 bg-amber-500/15 text-amber-200",
  success: "border-emerald-500/40 bg-emerald-500/15 text-emerald-200",
  info: "border-sky-500/40 bg-sky-500/15 text-sky-200",
  muted: "border-border bg-secondary/50 text-muted-foreground",
};

function buildQueueItem(
  card: LeadCardData,
  pendingDraftSids: Set<string>,
  factoryReceivedSids: Set<string>
): WorkQueueItem {
  const sid = card.sid.trim();
  const stage = (card.stage ?? "").toUpperCase();
  const subFlow = (card.qState as any)?.subFlow ?? null;
  const q = quoteNumber(card.quoteTotal);
  const staleHours = leadAgeHours(card);
  const reasons: QueueReason[] = [];
  let score = 0;

  if (card.pipelineFlag === "NEEDS_ELI") {
    reasons.push({
      key: "needs-eli",
      label: "צריך אותך",
      tone: "danger",
      icon: AlertCircle,
    });
    score += 120;
  }
  if (card.botPaused) {
    reasons.push({
      key: "paused",
      label: "בוט מושעה",
      tone: "warning",
      icon: Pause,
    });
    score += 80;
  }
  if (pendingDraftSids.has(sid)) {
    reasons.push({
      key: "draft",
      label: "טיוטה לאישור",
      tone: "info",
      icon: Inbox,
    });
    score += 90;
  }
  if (
    factoryReceivedSids.has(sid) ||
    (stage === "FACTORY_CHECK" && subFlow === "awaiting_factory_estimate")
  ) {
    reasons.push({
      key: "factory",
      label: "מחכה לתמחור",
      tone: "warning",
      icon: Factory,
    });
    score += 75;
  }
  if (hasCallSignal(card)) {
    reasons.push({
      key: "call",
      label: "ביקש שיחה",
      tone: "danger",
      icon: PhoneCall,
    });
    score += 70;
  }
  if (q >= 10000) {
    reasons.push({
      key: "large-quote",
      label: "הצעה גבוהה",
      tone: "success",
      icon: Banknote,
    });
    score += 55;
  }
  if (staleHours >= 48 && stage !== "WON" && stage !== "LOST") {
    reasons.push({
      key: "stale",
      label: "אין פעילות 48ש׳+",
      tone: "muted",
      icon: Clock3,
    });
    score += Math.min(50, Math.round(staleHours / 6));
  }

  const nextAction =
    reasons.find((r) => r.key === "draft")
      ? "לאשר / לערוך טיוטה"
      : reasons.find((r) => r.key === "factory")
        ? "לבדוק הצעת מפעל"
        : reasons.find((r) => r.key === "call")
          ? "לחזור בשיחה"
          : reasons.find((r) => r.key === "paused")
            ? "להחליט אם להחזיר את הבוט"
            : reasons.find((r) => r.key === "large-quote")
              ? "לקדם סגירה"
              : "לפתוח ליד";

  return { card, reasons, score, nextAction };
}

export function CommandCenter({ data }: { data: CommandCenterData }) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const pendingDraftSids = useMemo(
    () => new Set(data.pendingDraftSids.map((sid) => sid.trim())),
    [data.pendingDraftSids]
  );
  const factoryReceivedSids = useMemo(
    () => new Set(data.factoryReceivedSids.map((sid) => sid.trim())),
    [data.factoryReceivedSids]
  );

  const queue = useMemo(() => {
    const q = data.cards
      .map((card) => buildQueueItem(card, pendingDraftSids, factoryReceivedSids))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || leadAgeHours(b.card) - leadAgeHours(a.card));
    return q;
  }, [data.cards, factoryReceivedSids, pendingDraftSids]);

  const filteredQueue = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return queue;
    return queue.filter(({ card, reasons }) =>
      [
        card.name,
        card.phone,
        card.sid,
        card.lastInboundText,
        card.botSummary,
        card.notes,
        ...card.flags,
        ...reasons.map((r) => r.label),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(s)
    );
  }, [queue, search]);

  const moneyLeads = useMemo(
    () =>
      data.cards
        .filter((card) => quoteNumber(card.quoteTotal) > 0)
        .sort((a, b) => quoteNumber(b.quoteTotal) - quoteNumber(a.quoteTotal))
        .slice(0, 6),
    [data.cards]
  );

  const staleLeads = useMemo(
    () =>
      data.cards
        .filter((card) => {
          const stage = (card.stage ?? "").toUpperCase();
          return stage !== "WON" && stage !== "LOST" && leadAgeHours(card) >= 48;
        })
        .sort((a, b) => leadAgeHours(b) - leadAgeHours(a))
        .slice(0, 5),
    [data.cards]
  );

  const pausedCount = data.cards.filter((card) => card.botPaused).length;
  const needsEliCount = data.cards.filter(
    (card) => card.pipelineFlag === "NEEDS_ELI"
  ).length;
  const largeQuoteCount = data.cards.filter(
    (card) => quoteNumber(card.quoteTotal) >= 10000
  ).length;
  const topSources = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of data.cards) {
      const source = (card.leadSource || card.source || "לא ידוע").trim();
      counts.set(source, (counts.get(source) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([source, count]) => ({ source, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [data.cards]);
  const lifecycleCounts = useMemo(() => {
    const counts = new Map<LifecycleKey, number>();
    for (const card of data.cards) {
      const key = lifecycleOf(card.stage);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([key, count]) => ({ key, count }));
  }, [data.cards]);
  const priorityCounts = useMemo(() => {
    const counts = new Map<PriorityBand, number>();
    for (const card of data.cards) {
      const key = priorityOf(card);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return (["HOT", "WARM", "NURTURE", "LOW"] as PriorityBand[]).map((key) => ({
      key,
      count: counts.get(key) ?? 0,
    }));
  }, [data.cards]);

  const openLead = (sid: string) => {
    router.push(`/dashboard/v3?lead=${encodeURIComponent(sid)}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-xs font-medium text-primary">חדר בקרה יומי</p>
          <h1
            className="mt-1 text-3xl font-medium tracking-tight text-foreground"
            style={{ fontFamily: "var(--font-display)" }}
          >
            מה דורש אותך עכשיו
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            תור עבודה לפי דחיפות, חריגים, כסף על השולחן ובריאות הבוט. בלי לשנות את ה-flow.
          </p>
        </div>
        <div className="relative w-full xl:w-80">
          <Search className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="חיפוש שם, טלפון, הודעה או סיבה"
            className="h-10 w-full rounded-lg border border-border bg-card pr-9 pl-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring/40"
          />
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric
          icon={ShieldAlert}
          label="דורש אותך"
          value={queue.length}
          tone={queue.length > 0 ? "danger" : "success"}
        />
        <Metric
          icon={Inbox}
          label="טיוטות לאישור"
          value={data.pendingDrafts}
          tone={data.pendingDrafts > 0 ? "warning" : "success"}
        />
        <Metric
          icon={Factory}
          label="הצעות מפעל"
          value={data.factoryReceived}
          tone={data.factoryReceived > 0 ? "warning" : "muted"}
        />
        <Metric
          icon={Users}
          label="לידים פעילים"
          value={data.cards.length}
          tone="info"
        />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-lg border border-border bg-card/50">
          <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
            <div>
              <h2 className="text-base font-medium">תור עבודה</h2>
              <p className="text-xs text-muted-foreground">
                ממוין לפי התערבות אנושית, תמחור, טיוטות, הצעות גבוהות וזמן המתנה.
              </p>
            </div>
            <span className="rounded-full border border-border bg-background/50 px-2.5 py-1 text-xs text-muted-foreground tabular-nums">
              {filteredQueue.length}
            </span>
          </div>
          <div className="divide-y divide-border/60">
            {filteredQueue.slice(0, 18).map((item) => (
              <WorkQueueRow
                key={item.card.sid}
                item={item}
                onOpen={() => openLead(item.card.sid)}
              />
            ))}
            {filteredQueue.length === 0 && (
              <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                אין כרגע חריגים בתור העבודה.
              </div>
            )}
          </div>
        </section>

        <aside className="flex flex-col gap-4">
          <Panel
            title="משימות CRM"
            description="משימות אמיתיות אחרי migration; כרגע מוצג fallback אם הטבלה ריקה"
            icon={Inbox}
          >
            <div className="flex flex-col gap-2">
              {data.crmTasks.slice(0, 6).map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => openLead(task.sid)}
                  className="rounded-lg border border-border/70 bg-background/30 p-3 text-right transition-colors hover:bg-secondary/70"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium">{task.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {task.dueAt ? timeAgoHe(task.dueAt) : "ללא יעד"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{task.taskType}</div>
                </button>
              ))}
              {data.crmTasks.length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  אין עדיין משימות CRM פתוחות.
                </div>
              )}
            </div>
          </Panel>

          <Panel
            title="SLA אמיתי"
            description={`${data.crmSla.filter((row) => row.breached).length} חריגות מתוך ${data.crmSla.length} טיימרים פתוחים`}
            icon={Clock3}
          >
            <div className="flex flex-col gap-2">
              {data.crmSla.slice(0, 5).map((timer) => (
                <button
                  key={timer.id}
                  type="button"
                  onClick={() => openLead(timer.sid)}
                  className={cn(
                    "rounded-lg border p-3 text-right transition-colors hover:bg-secondary/70",
                    timer.breached
                      ? "border-rose-500/40 bg-rose-500/10"
                      : "border-border/70 bg-background/30"
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium">{timer.slaType}</span>
                    <span className="text-xs text-muted-foreground">
                      {timeAgoHe(timer.dueAt)}
                    </span>
                  </div>
                  <div className={cn("mt-1 text-xs", timer.breached ? "text-rose-200" : "text-muted-foreground")}>
                    {timer.breached ? "חריגה" : "פתוח"}
                  </div>
                </button>
              ))}
              {data.crmSla.length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  אין עדיין SLA timers פתוחים.
                </div>
              )}
            </div>
          </Panel>

          <Panel
            title="חריגות SLA שקטות"
            description="לידים פעילים בלי פעילות 48 שעות ומעלה"
            icon={Clock3}
          >
            <div className="flex flex-col gap-2">
              {staleLeads.map((card) => (
                <button
                  key={card.sid}
                  type="button"
                  onClick={() => openLead(card.sid)}
                  className="rounded-lg border border-border/70 bg-background/30 p-3 text-right transition-colors hover:bg-secondary/70"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium">
                      {card.name || card.phone || shortSid(card.sid)}
                    </span>
                    <span className="shrink-0 text-xs text-warning tabular-nums">
                      {timeAgoHe(card.lastInboundAt ?? card.updatedAt)}
                    </span>
                  </div>
                  <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                    {card.lastInboundText || card.botSummary || "אין הודעה אחרונה"}
                  </div>
                </button>
              ))}
              {staleLeads.length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  אין כרגע חריגות SLA שקטות.
                </div>
              )}
            </div>
          </Panel>

          <Panel
            title="כסף על השולחן"
            description={`${largeQuoteCount} הצעות מעל 10,000 ₪`}
            icon={Banknote}
          >
            <div className="flex flex-col gap-2">
              {moneyLeads.map((card) => (
                <button
                  key={card.sid}
                  type="button"
                  onClick={() => openLead(card.sid)}
                  className="rounded-lg border border-border/70 bg-background/30 p-3 text-right transition-colors hover:bg-secondary/70"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium">
                      {card.name || card.phone || shortSid(card.sid)}
                    </span>
                    <span className="shrink-0 text-sm font-medium tabular-nums text-success">
                      ₪{quoteNumber(card.quoteTotal).toLocaleString("he-IL")}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {STAGE_LABEL[(card.stage ?? "PRE_QUOTE").toUpperCase()] ?? card.stage}
                  </div>
                </button>
              ))}
              {moneyLeads.length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  אין כרגע הצעות פעילות עם סכום.
                </div>
              )}
            </div>
          </Panel>

          <Panel title="בריאות הבוט" description="נקודות שמצריכות בקרה" icon={Bot}>
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="בוט מושעה" value={pausedCount} />
              <MiniStat label="צריך אדם" value={needsEliCount} />
              <MiniStat label="טיוטות" value={data.pendingDrafts} />
              <MiniStat label="תמחור מפעל" value={data.factoryReceived} />
            </div>
          </Panel>

          <Panel title="עדיפות" description="Priority band מחושב מהסיגנלים הקיימים" icon={ShieldAlert}>
            <div className="grid grid-cols-2 gap-2">
              {priorityCounts.map((row) => (
                <MiniStat
                  key={row.key}
                  label={PRIORITY_LABEL[row.key]}
                  value={row.count}
                />
              ))}
            </div>
          </Panel>

          <Panel title="ניקוד לידים" description="Score snapshots אמיתיים אחרי migration" icon={Sparkles}>
            <div className="flex flex-col gap-2">
              {data.latestScores.slice(0, 5).map((score) => (
                <button
                  key={score.sid}
                  type="button"
                  onClick={() => openLead(score.sid)}
                  className="rounded-lg border border-border/70 bg-background/30 p-3 text-right transition-colors hover:bg-secondary/70"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium">{score.scoreBand}</span>
                    <span className="text-sm font-medium tabular-nums text-primary">
                      {score.scoreTotal}
                    </span>
                  </div>
                  {score.reason && (
                    <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {score.reason}
                    </div>
                  )}
                </button>
              ))}
              {data.latestScores.length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  אין עדיין score snapshots.
                </div>
              )}
            </div>
          </Panel>

          <Panel title="מחזור חיים" description="מיפוי CRM מעל שלבי הבוט" icon={Sparkles}>
            <div className="flex flex-col gap-2">
              {lifecycleCounts.map((row) => (
                <div
                  key={row.key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/30 px-3 py-2"
                >
                  <span className="truncate text-xs text-muted-foreground">
                    {LIFECYCLE_LABEL[row.key]}
                  </span>
                  <span className="text-sm font-medium tabular-nums">
                    {row.count.toLocaleString("he-IL")}
                  </span>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="מקורות לידים" description="Attribution בסיסי מהשדות הקיימים" icon={Users}>
            <div className="flex flex-col gap-2">
              {topSources.map((row) => (
                <div
                  key={row.source}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/30 px-3 py-2"
                >
                  <span className="truncate text-xs text-muted-foreground">
                    {row.source}
                  </span>
                  <span className="text-sm font-medium tabular-nums">
                    {row.count.toLocaleString("he-IL")}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof AlertCircle;
  label: string;
  value: number;
  tone: QueueReason["tone"];
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={cn("rounded-lg border p-1.5", REASON_TONE[tone])}>
          <Icon className="size-4" />
        </div>
      </div>
      <div
        className="mt-3 text-2xl font-medium tabular-nums"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {value.toLocaleString("he-IL")}
      </div>
    </div>
  );
}

function WorkQueueRow({
  item,
  onOpen,
}: {
  item: WorkQueueItem;
  onOpen: () => void;
}) {
  const { card, reasons } = item;
  const stage = (card.stage ?? "PRE_QUOTE").toUpperCase();
  const stageTone = STAGE_TONE[stage] ?? STAGE_TONE.UNCLASSIFIED;
  const displayName = card.name || card.phone || shortSid(card.sid);
  const priority = priorityOf(card);
  const lifecycle = lifecycleOf(card.stage);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="grid w-full grid-cols-1 gap-3 px-4 py-3 text-right transition-colors hover:bg-secondary/50 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]"
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{displayName}</span>
          {card.botPaused && <Pause className="size-3.5 shrink-0 text-warning" />}
          {card.lastInboundText && (
            <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" />
          )}
        </div>
        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
          {card.lastInboundText || card.botSummary || card.phone || card.sid}
        </div>
      </div>

      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {reasons.slice(0, 3).map((reason) => {
          const Icon = reason.icon;
          return (
            <span
              key={reason.key}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                REASON_TONE[reason.tone]
              )}
            >
              <Icon className="size-3" />
              {reason.label}
            </span>
          );
        })}
        <span className={cn("rounded-full px-2 py-0.5 text-[11px]", stageTone.pill)}>
          {STAGE_LABEL[stage] ?? stage}
        </span>
        <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
          {PRIORITY_LABEL[priority]}
        </span>
        <span className="rounded-full border border-border bg-background/40 px-2 py-0.5 text-[11px] text-muted-foreground">
          {LIFECYCLE_LABEL[lifecycle]}
        </span>
        {card.quoteTotal && (
          <span className="rounded-full border border-border bg-background/40 px-2 py-0.5 text-[11px] tabular-nums">
            ₪{quoteNumber(card.quoteTotal).toLocaleString("he-IL")}
          </span>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 lg:min-w-40 lg:justify-end">
        <span className="text-xs text-muted-foreground tabular-nums">
          {timeAgoHe(card.lastInboundAt ?? card.updatedAt)}
        </span>
        <span className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground">
          <Sparkles className="size-3" />
          {item.nextAction}
        </span>
      </div>
    </button>
  );
}

function Panel({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description: string;
  icon: typeof AlertCircle;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card/50 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-medium">{title}</h2>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="rounded-lg border border-border bg-background/50 p-1.5 text-muted-foreground">
          <Icon className="size-4" />
        </div>
      </div>
      {children}
    </section>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-medium tabular-nums">
        {value.toLocaleString("he-IL")}
      </div>
    </div>
  );
}

function shortSid(sid: string): string {
  const before = sid.split("@")[0] || sid;
  return before.length > 5 ? `...${before.slice(-5)}` : before;
}
