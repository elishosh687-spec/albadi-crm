"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Users, Inbox, Banknote, TrendingUp, Bot, MessageSquare, CheckCircle2, XCircle } from "lucide-react";
import { STAGE_LABEL, STAGE_TONE } from "../_components/stage-meta";
import { cn } from "@/lib/cn";
import {
  LIFECYCLE_LABEL,
  PRIORITY_LABEL,
  type LifecycleKey,
  type PriorityBand,
} from "../_components/crm-insights";

export interface AnalyticsData {
  activeLeadsCount: number;
  newLeadsWeek: number;
  pendingDrafts: number;
  wonMonthSumIls: number;
  sentThisMonth: number;
  inboundLeadsMonth: number;
  botApprovalRatePct: number | null;
  botDraftsMonth: { sent: number; rejected: number; failed: number };
  todayMessages: { bot: number; eli: number; lead: number };
  operations: {
    needsHuman: number;
    pausedLeads: number;
    staleActiveLeads: number;
    manualReviewLeads: number;
  };
  revenueOps: {
    quotedLeads: number;
    largeQuotedLeads: number;
  };
  botQa: {
    activeQuestionnaires: number;
    completedQuestionnaires: number;
    bailedQuestionnaires: number;
    handoffRatePct: number | null;
  };
  sourcePerformance: Array<{
    source: string;
    leads: number;
    won: number;
    quoted: number;
  }>;
  lifecycleDist: Array<{ lifecycle: LifecycleKey; count: number }>;
  priorityDist: Array<{ priority: PriorityBand; count: number }>;
  crmOps: {
    openTasks: number;
    breachedSla: number;
    openSla: number;
    openOpportunities: number;
    latestScores: number;
  };
  funnel: Array<{ stage: string; count: number }>;
  pipelineDist: Array<{ stage: string; count: number }>;
}

const ACCENT_BG: Record<string, string> = {
  primary: "bg-primary/15 text-primary",
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
  info: "bg-sky-500/15 text-sky-300",
};

export function AnalyticsView({ data }: { data: AnalyticsData }) {
  const funnelMax = Math.max(...data.funnel.map((f) => f.count), 1);
  const pipelineChart = data.pipelineDist.map((p) => ({
    stage: STAGE_LABEL[p.stage] ?? p.stage,
    count: p.count,
    color: extractFill(p.stage),
  }));

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1
          className="text-3xl font-medium tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          אנליטיקה
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          מבט ניהולי על בריאות הבוט, תור ההתערבות והכסף במשפך ב-30 הימים האחרונים.
        </p>
      </header>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          תפעול יומי
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi
            icon={<Users className="size-4" />}
            label="לידים חדשים (שבוע)"
            value={data.newLeadsWeek.toLocaleString("he-IL")}
            accent="primary"
          />
          <Kpi
            icon={<Inbox className="size-4" />}
            label="תור אישורים"
            value={data.pendingDrafts.toLocaleString("he-IL")}
            accent={data.pendingDrafts > 0 ? "warning" : "success"}
          />
          <Kpi
            icon={<Banknote className="size-4" />}
            label="₪ WON (חודש)"
            value={`₪${data.wonMonthSumIls.toLocaleString("he-IL")}`}
            accent="success"
          />
          <Kpi
            icon={<TrendingUp className="size-4" />}
            label="לידים פעילים"
            value={data.activeLeadsCount.toLocaleString("he-IL")}
            accent="info"
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          תגובה ו-SLA
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi
            icon={<Inbox className="size-4" />}
            label="דורש אדם"
            value={data.operations.needsHuman.toLocaleString("he-IL")}
            accent={data.operations.needsHuman > 0 ? "destructive" : "success"}
          />
          <Kpi
            icon={<Bot className="size-4" />}
            label="בוט מושעה"
            value={data.operations.pausedLeads.toLocaleString("he-IL")}
            accent={data.operations.pausedLeads > 0 ? "warning" : "success"}
          />
          <Kpi
            icon={<XCircle className="size-4" />}
            label="אין פעילות 48ש׳+"
            value={data.operations.staleActiveLeads.toLocaleString("he-IL")}
            accent={data.operations.staleActiveLeads > 0 ? "warning" : "success"}
          />
          <Kpi
            icon={<MessageSquare className="size-4" />}
            label="תמחור / בדיקה ידנית"
            value={data.operations.manualReviewLeads.toLocaleString("he-IL")}
            accent={data.operations.manualReviewLeads > 0 ? "warning" : "info"}
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          מחזור חיים ועדיפות
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <DistributionPanel
            title="מחזור חיים"
            rows={data.lifecycleDist.map((row) => ({
              label: LIFECYCLE_LABEL[row.lifecycle],
              count: row.count,
            }))}
          />
          <DistributionPanel
            title="עדיפות"
            rows={data.priorityDist.map((row) => ({
              label: PRIORITY_LABEL[row.priority],
              count: row.count,
            }))}
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          שכבת CRM אמיתית
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <Kpi
            icon={<Inbox className="size-4" />}
            label="משימות פתוחות"
            value={data.crmOps.openTasks.toLocaleString("he-IL")}
            accent={data.crmOps.openTasks > 0 ? "warning" : "success"}
          />
          <Kpi
            icon={<XCircle className="size-4" />}
            label="SLA חריג"
            value={data.crmOps.breachedSla.toLocaleString("he-IL")}
            accent={data.crmOps.breachedSla > 0 ? "destructive" : "success"}
          />
          <Kpi
            icon={<MessageSquare className="size-4" />}
            label="SLA פתוח"
            value={data.crmOps.openSla.toLocaleString("he-IL")}
            accent="info"
          />
          <Kpi
            icon={<Banknote className="size-4" />}
            label="Opportunities"
            value={data.crmOps.openOpportunities.toLocaleString("he-IL")}
            accent="success"
          />
          <Kpi
            icon={<TrendingUp className="size-4" />}
            label="Score snapshots"
            value={data.crmOps.latestScores.toLocaleString("he-IL")}
            accent="primary"
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          בריאות הבוט
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi
            icon={<Bot className="size-4" />}
            label="טיוטות נשלחו"
            value={data.botDraftsMonth.sent.toLocaleString("he-IL")}
            accent="success"
          />
          <Kpi
            icon={<XCircle className="size-4" />}
            label="טיוטות נדחו"
            value={data.botDraftsMonth.rejected.toLocaleString("he-IL")}
            accent="warning"
          />
          <Kpi
            icon={<CheckCircle2 className="size-4" />}
            label="שיעור אישור טיוטות"
            value={
              data.botApprovalRatePct === null
                ? "—"
                : `${data.botApprovalRatePct}%`
            }
            accent={data.botApprovalRatePct === null
              ? "info"
              : data.botApprovalRatePct >= 70
              ? "success"
              : "warning"}
          />
          <Kpi
            icon={<MessageSquare className="size-4" />}
            label="הודעות היום (בוט / אני / לקוח)"
            value={`${data.todayMessages.bot}/${data.todayMessages.eli}/${data.todayMessages.lead}`}
            accent="primary"
          />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-3">
          <Kpi
            icon={<Bot className="size-4" />}
            label="שאלונים פעילים"
            value={data.botQa.activeQuestionnaires.toLocaleString("he-IL")}
            accent="info"
          />
          <Kpi
            icon={<CheckCircle2 className="size-4" />}
            label="שאלונים שהושלמו"
            value={data.botQa.completedQuestionnaires.toLocaleString("he-IL")}
            accent="success"
          />
          <Kpi
            icon={<XCircle className="size-4" />}
            label="נפילות שאלון"
            value={data.botQa.bailedQuestionnaires.toLocaleString("he-IL")}
            accent={data.botQa.bailedQuestionnaires > 0 ? "warning" : "success"}
          />
          <Kpi
            icon={<Inbox className="size-4" />}
            label="שיעור handoff"
            value={
              data.botQa.handoffRatePct === null
                ? "—"
                : `${data.botQa.handoffRatePct}%`
            }
            accent={
              data.botQa.handoffRatePct === null || data.botQa.handoffRatePct < 25
                ? "success"
                : "warning"
            }
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          כסף על השולחן
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Kpi
            icon={<Banknote className="size-4" />}
            label="לידים עם הצעה"
            value={data.revenueOps.quotedLeads.toLocaleString("he-IL")}
            accent="success"
          />
          <Kpi
            icon={<TrendingUp className="size-4" />}
            label="הצעות מעל 10,000 ₪"
            value={data.revenueOps.largeQuotedLeads.toLocaleString("he-IL")}
            accent={data.revenueOps.largeQuotedLeads > 0 ? "success" : "info"}
          />
          <Kpi
            icon={<Banknote className="size-4" />}
            label="₪ WON החודש"
            value={`₪${data.wonMonthSumIls.toLocaleString("he-IL")}`}
            accent="success"
          />
          <Kpi
            icon={<TrendingUp className="size-4" />}
            label="טיוטות שנשלחו"
            value={data.sentThisMonth.toLocaleString("he-IL")}
            accent="primary"
          />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          מקורות לידים
        </h2>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="grid grid-cols-[minmax(0,1fr)_80px_80px_80px] gap-3 border-b border-border/60 pb-2 text-xs text-muted-foreground">
            <span>מקור</span>
            <span className="text-left">לידים</span>
            <span className="text-left">הצעות</span>
            <span className="text-left">WON</span>
          </div>
          <div className="divide-y divide-border/60">
            {data.sourcePerformance.map((row) => (
              <div
                key={row.source}
                className="grid grid-cols-[minmax(0,1fr)_80px_80px_80px] gap-3 py-2 text-sm"
              >
                <span className="truncate text-foreground">{row.source}</span>
                <span className="text-left tabular-nums">{row.leads}</span>
                <span className="text-left tabular-nums">{row.quoted}</span>
                <span className="text-left tabular-nums text-success">{row.won}</span>
              </div>
            ))}
            {data.sourcePerformance.length === 0 && (
              <div className="py-6 text-center text-sm text-muted-foreground">
                אין עדיין מספיק נתוני מקור.
              </div>
            )}
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          משפך המרה והכנסות
        </h2>
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-col gap-2.5">
            {data.funnel.map((f, i) => {
              const widthPct = Math.max(8, (f.count / funnelMax) * 100);
              const dropFromPrev =
                i > 0 && data.funnel[i - 1].count > 0
                  ? Math.round((1 - f.count / data.funnel[i - 1].count) * 100)
                  : null;
              const tone = STAGE_TONE[f.stage] ?? STAGE_TONE.UNCLASSIFIED;
              return (
                <div key={f.stage} className="flex items-center gap-3">
                  <div className="w-28 shrink-0 text-xs text-muted-foreground text-right">
                    {STAGE_LABEL[f.stage] ?? f.stage}
                  </div>
                  <div className="flex-1 h-7 bg-muted/30 rounded-md relative overflow-hidden">
                    <div
                      className={cn("h-full rounded-md transition-all", tone.bar)}
                      style={{ width: `${widthPct}%` }}
                    />
                    <span className="absolute inset-y-0 right-2 flex items-center text-xs font-medium tabular-nums">
                      {f.count}
                    </span>
                  </div>
                  <div className="w-12 shrink-0 text-xs text-muted-foreground tabular-nums">
                    {dropFromPrev !== null && dropFromPrev > 0 ? `-${dropFromPrev}%` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          פיזור לפי שלב
        </h2>
        <div className="rounded-xl border border-border bg-card p-5 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pipelineChart} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.3 0.02 270)" />
              <XAxis
                dataKey="stage"
                stroke="oklch(0.6 0.02 270)"
                tick={{ fontSize: 11 }}
                interval={0}
              />
              <YAxis stroke="oklch(0.6 0.02 270)" tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip
                contentStyle={{
                  background: "oklch(0.22 0.02 270)",
                  border: "1px solid oklch(0.28 0.02 270)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
                cursor={{ fill: "oklch(0.25 0.02 270 / 0.5)" }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {pipelineChart.map((entry, index) => (
                  <Cell key={`c-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  icon,
  accent = "primary",
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
  accent?: "primary" | "success" | "warning" | "destructive" | "info";
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        {icon && (
          <div className={cn("rounded-lg p-1.5", ACCENT_BG[accent])}>
            {icon}
          </div>
        )}
      </div>
      <div
        className="mt-2 text-2xl font-medium text-foreground tabular-nums"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {value}
      </div>
    </div>
  );
}

function DistributionPanel({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; count: number }>;
}) {
  const max = Math.max(...rows.map((row) => row.count), 1);

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="mb-3 text-sm font-medium">{title}</h3>
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[110px_1fr_44px] items-center gap-3">
            <span className="truncate text-xs text-muted-foreground">{row.label}</span>
            <div className="h-2 rounded-full bg-muted/40">
              <div
                className="h-full rounded-full bg-primary/70"
                style={{ width: `${Math.max(4, (row.count / max) * 100)}%` }}
              />
            </div>
            <span className="text-left text-xs tabular-nums">{row.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function extractFill(stage: string): string {
  // Map the Tailwind tone -> approximate fill color for recharts (no dynamic
  // Tailwind reading at runtime). Falls back to muted.
  const map: Record<string, string> = {
    NEW: "#0ea5e9",
    AWAITING_ESTIMATE: "#d946ef",
    AWAITING_LOGO: "#06b6d4",
    WAITING_FACTORY: "#f59e0b",
    AWAITING_FINAL: "#f43f5e",
    WON: "#10b981",
    DROPPED: "#64748b",
    UNCLASSIFIED: "#94a3b8",
  };
  return map[stage] ?? "#64748b";
}
