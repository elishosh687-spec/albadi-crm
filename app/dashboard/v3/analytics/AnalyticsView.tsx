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
          סיכום של 30 הימים האחרונים. Bot performance + Funnel + KPIs.
        </p>
      </header>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Business KPIs
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
          Bot Performance (30 ימים)
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
            label="Approval rate"
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
      </section>

      <section>
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-3">
          Conversion Funnel
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
          Pipeline Distribution
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
