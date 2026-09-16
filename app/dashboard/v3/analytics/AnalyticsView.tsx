"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, Banknote, Bot, CheckCircle2, CircleDollarSign,
  Clock3, Inbox, MessageSquare, PhoneCall, Target, Users,
} from "lucide-react";
import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { cn } from "@/lib/cn";
import { percentage } from "@/lib/analytics/funnel";
import { STAGE_LABEL } from "../_components/stage-meta";
import {
  LIFECYCLE_LABEL, PRIORITY_LABEL, type LifecycleKey, type PriorityBand,
} from "../_components/crm-insights";
import { SalesTargetsForm } from "./SalesTargetsForm";

export interface AnalyticsData {
  generatedAt: string;
  dataHealth: { status: "healthy" | "unhealthy" | "error"; checkedAt: string; totalGaps: number } | null;
  activeLeadsCount: number;
  newLeadsWeek: number;
  pendingDrafts: number;
  wonMonthSumIls: number;
  sentThisMonth: number;
  inboundLeadsMonth: number;
  botApprovalRatePct: number | null;
  botDraftsMonth: { sent: number; rejected: number; failed: number };
  todayMessages: { bot: number; eli: number; lead: number };
  operations: { needsHuman: number; pausedLeads: number; staleActiveLeads: number; manualReviewLeads: number };
  revenueOps: { quotedLeads: number; largeQuotedLeads: number };
  botQa: { activeQuestionnaires: number; completedQuestionnaires: number; bailedQuestionnaires: number; handoffRatePct: number | null };
  botFunnel: Array<{ event: string; label: string; attempts: number; uniqueLeads: number }>;
  salesOutcomes: {
    replied: number; humanReturned: number; called: number; qualified: number; closed: number;
    avgHumanResponseMinutes: number | null; medianHumanResponseMinutes: number | null; avgFollowups: number | null;
  };
  qualification: Array<{ key: string; label: string; count: number }>;
  lossReasons: Array<{ key: string; label: string; count: number }>;
  dealEconomics: { deals: number; averageProfitIls: number | null; medianProfitIls: number | null };
  salesTargets: { maxCustomerAcquisitionCostIls: number | null; dailyAdTestBudgetIls: number | null };
  sourcePerformance: Array<{ source: string; leads: number; won: number; quoted: number }>;
  lifecycleDist: Array<{ lifecycle: LifecycleKey; count: number }>;
  priorityDist: Array<{ priority: PriorityBand; count: number }>;
  crmOps: { openTasks: number; breachedSla: number; openSla: number; openOpportunities: number; latestScores: number };
  funnel: Array<{ stage: string; count: number }>;
  pipelineDist: Array<{ stage: string; count: number }>;
}

type ViewKey = "sales" | "operations" | "bot";
const VIEWS: Array<{ key: ViewKey; label: string }> = [
  { key: "sales", label: "משפך ומכירות" },
  { key: "operations", label: "תפעול ו־SLA" },
  { key: "bot", label: "בריאות הבוט" },
];

export function AnalyticsView({ data }: { data: AnalyticsData }) {
  const router = useRouter();
  const [view, setView] = useState<ViewKey>("sales");
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [router]);
  const started = data.botFunnel.find((row) => row.event === "questionnaire_started")?.uniqueLeads ?? 0;
  const quoted = data.botFunnel.find((row) => row.event === "quote_sent")?.uniqueLeads ?? 0;
  const replied = data.botFunnel.find((row) => row.event === "quote_replied")?.uniqueLeads ?? 0;
  const totalQuality = data.qualification.reduce((sum, row) => sum + row.count, 0);
  const unclassified = data.qualification.find((row) => row.key === "UNCLASSIFIED")?.count ?? 0;
  const classificationRate = percentage(totalQuality - unclassified, totalQuality);
  const healthLabel = !data.dataHealth
    ? "הניטור ממתין לבדיקה ראשונה"
    : data.dataHealth.status === "healthy"
      ? "המשפך תקין"
      : data.dataHealth.status === "error"
        ? "בדיקת המשפך נכשלה"
        : `נמצאו ${data.dataHealth.totalGaps} פערים`;

  return (
    <div className="mx-auto flex w-full max-w-[1420px] flex-col gap-6 pb-16">
      <header className="border-b border-border/70 pb-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="mb-2 text-xs font-medium tracking-[0.18em] text-primary">מרכז ביצועים</p>
            <h1 className="text-3xl font-semibold tracking-tight md:text-4xl" style={{ fontFamily: "var(--font-display)" }}>
              מה קורה מהליד הראשון ועד העסקה
            </h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              משפך אחד שמחבר את הבוט, המענה האנושי, איכות הלידים והרווח — בלי לספור התחלה חוזרת כליד חדש.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className={cn("size-2 rounded-full", data.dataHealth?.status === "healthy" ? "bg-success" : data.dataHealth ? "bg-destructive" : "bg-warning")} aria-hidden="true" />
            <span>{healthLabel}</span>
            <span aria-hidden="true">·</span>
            <span>מתרענן כל דקה · עודכן {new Date(data.generatedAt).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short" })}</span>
          </div>
        </div>
      </header>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(290px,0.75fr)]">
        <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border bg-card md:grid-cols-4">
          <HeadlineMetric label="לידים חדשים השבוע" value={formatNumber(data.newLeadsWeek)} icon={<Users />} />
          <HeadlineMetric label="הגיבו למחיר" value={formatNumber(data.salesOutcomes.replied)} icon={<MessageSquare />} />
          <HeadlineMetric label="נסגרו" value={formatNumber(data.salesOutcomes.closed)} icon={<CheckCircle2 />} />
          <HeadlineMetric label="הכנסות החודש" value={formatIls(data.wonMonthSumIls)} icon={<Banknote />} />
        </div>
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-2"><Target className="size-4 text-primary" /><h2 className="text-sm font-semibold">שלוש נקודות לבדיקה</h2></div>
          <div className="space-y-3">
            <SignalRow label="המרה מהתחלה למחיר" value={formatPercent(percentage(quoted, started))} />
            <SignalRow label="תגובה אחרי מחיר" value={formatPercent(percentage(replied, quoted))} />
            <SignalRow label="לידים שסווגו" value={formatPercent(classificationRate)} tone={classificationRate !== null && classificationRate < 50 ? "warning" : "default"} />
          </div>
        </div>
      </section>

      <nav className="flex w-full gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1" role="tablist" aria-label="תחומי אנליטיקה">
        {VIEWS.map((item) => (
          <button key={item.key} type="button" role="tab" aria-selected={view === item.key} onClick={() => setView(item.key)}
            className={cn("min-h-11 min-w-fit flex-1 rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary", view === item.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground")}>
            {item.label}
          </button>
        ))}
      </nav>

      {view === "sales" && <SalesView data={data} />}
      {view === "operations" && <OperationsView data={data} />}
      {view === "bot" && <BotHealthView data={data} />}
    </div>
  );
}

function SalesView({ data }: { data: AnalyticsData }) {
  const replied = data.salesOutcomes.replied;
  return (
    <div role="tabpanel" className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
        <Panel title="משפך הבוט" description="לידים ייחודיים הם המדד להמרה; ניסיונות כוללים התחלה מחדש."><Funnel rows={data.botFunnel} /></Panel>
        <Panel title="מה קרה אחרי המחיר" description="אותה קבוצת לידים שהגיבה להצעה הראשונית.">
          <OutcomePath rows={[
            { label: "הגיבו למחיר", value: replied, icon: <MessageSquare /> },
            { label: "נציג חזר", value: data.salesOutcomes.humanReturned, icon: <ArrowLeft /> },
            { label: "התקיימה שיחה", value: data.salesOutcomes.called, icon: <PhoneCall /> },
            { label: "נמצאו מתאימים", value: data.salesOutcomes.qualified, icon: <Target /> },
            { label: "נסגרו", value: data.salesOutcomes.closed, icon: <CheckCircle2 /> },
          ]} />
          <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
            <CompactStat label="חציון למענה אנושי" value={formatMinutes(data.salesOutcomes.medianHumanResponseMinutes)} />
            <CompactStat label="ממוצע ניסיונות מעקב" value={data.salesOutcomes.avgFollowups === null ? "—" : data.salesOutcomes.avgFollowups.toFixed(1)} />
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Panel title="איכות הלידים" description="איכות מתארת התאמה ובשלות — לא את סיבת ההפסד."><Distribution rows={data.qualification} emptyLabel="אין עדיין סיווגי איכות" /></Panel>
        <Panel title="למה עסקאות לא נסגרו" description="סיבות מובנות כדי לראות אם הבעיה היא מחיר, תזמון או התאמה."><Distribution rows={data.lossReasons} emptyLabel="אין עדיין סיבות מתועדות" /></Panel>
      </div>

      <Panel title="כלכלת העסקה" description="רווח בפועל כשיש עלויות אמת; אחרת הרווח המתוכנן מההצעה הסגורה.">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
            <CompactStat label="עסקאות עם נתוני רווח" value={formatNumber(data.dealEconomics.deals)} />
            <CompactStat label="רווח חציוני" value={formatIls(data.dealEconomics.medianProfitIls)} emphasis />
            <CompactStat label="רווח ממוצע" value={formatIls(data.dealEconomics.averageProfitIls)} />
            <CompactStat label="CAC מקסימלי" value={formatIls(data.salesTargets.maxCustomerAcquisitionCostIls)} />
          </div>
          <SalesTargetsForm {...data.salesTargets} />
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <Panel title="מקורות לידים" description="מי מביא נפח, מי מתקדם להצעה ומי נסגר."><SourceTable rows={data.sourcePerformance} /></Panel>
        <Panel title="פיזור בצינור המכירה" description="המצב הנוכחי של הלידים הפעילים."><PipelineChart rows={data.pipelineDist} /></Panel>
      </div>
    </div>
  );
}

function OperationsView({ data }: { data: AnalyticsData }) {
  return (
    <div role="tabpanel" className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
        <Panel title="תור העבודה עכשיו" description="המספרים שדורשים פעולה של נציג, לא רק מעקב.">
          <div className="divide-y divide-border/60">
            <ActionMetric icon={<Inbox />} label="דורש אדם" value={data.operations.needsHuman} href="/dashboard/v3/leads" critical={data.operations.needsHuman > 0} />
            <ActionMetric icon={<AlertTriangle />} label="ללא פעילות מעל 48 שעות" value={data.operations.staleActiveLeads} href="/dashboard/v3/leads" critical={data.operations.staleActiveLeads > 0} />
            <ActionMetric icon={<Bot />} label="בוט מושעה" value={data.operations.pausedLeads} href="/dashboard/v3/leads" />
            <ActionMetric icon={<CircleDollarSign />} label="ממתינים לתמחור ידני" value={data.operations.manualReviewLeads} href="/dashboard/v3/factory" />
          </div>
        </Panel>
        <Panel title="מהירות תגובה" description="מהצעת המחיר הראשונה ועד שנציג פונה.">
          <div className="space-y-5">
            <LargeMetric label="חציון" value={formatMinutes(data.salesOutcomes.medianHumanResponseMinutes)} icon={<Clock3 />} />
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
              <CompactStat label="ממוצע" value={formatMinutes(data.salesOutcomes.avgHumanResponseMinutes)} />
              <CompactStat label="פולואפים ממוצעים" value={data.salesOutcomes.avgFollowups === null ? "—" : data.salesOutcomes.avgFollowups.toFixed(1)} />
            </div>
          </div>
        </Panel>
      </div>
      <Panel title="שכבת ה־CRM" description="משימות, חריגות SLA והזדמנויות פתוחות.">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-5">
          <CompactStat label="משימות פתוחות" value={formatNumber(data.crmOps.openTasks)} />
          <CompactStat label="SLA חריג" value={formatNumber(data.crmOps.breachedSla)} danger={data.crmOps.breachedSla > 0} />
          <CompactStat label="SLA פתוח" value={formatNumber(data.crmOps.openSla)} />
          <CompactStat label="הזדמנויות" value={formatNumber(data.crmOps.openOpportunities)} />
          <CompactStat label="ציוני לידים" value={formatNumber(data.crmOps.latestScores)} />
        </div>
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="מחזור חיים"><Distribution rows={data.lifecycleDist.map((row) => ({ key: row.lifecycle, label: LIFECYCLE_LABEL[row.lifecycle], count: row.count }))} /></Panel>
        <Panel title="עדיפות לטיפול"><Distribution rows={data.priorityDist.map((row) => ({ key: row.priority, label: PRIORITY_LABEL[row.priority], count: row.count }))} /></Panel>
      </div>
    </div>
  );
}

function BotHealthView({ data }: { data: AnalyticsData }) {
  const messageTotal = data.todayMessages.lead + data.todayMessages.bot + data.todayMessages.eli;
  return (
    <div role="tabpanel" className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
        <Panel title="איכות האוטומציה" description="טיוטות, אישורים והעברות לטיפול אנושי ב־30 הימים האחרונים.">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4">
            <CompactStat label="טיוטות שנשלחו" value={formatNumber(data.botDraftsMonth.sent)} />
            <CompactStat label="טיוטות שנדחו" value={formatNumber(data.botDraftsMonth.rejected)} />
            <CompactStat label="שיעור אישור" value={formatPercent(data.botApprovalRatePct)} emphasis />
            <CompactStat label="שיעור העברה לאדם" value={formatPercent(data.botQa.handoffRatePct)} />
          </div>
        </Panel>
        <Panel title="הודעות היום" description="חלוקת השיחה בין הבוט, הנציג והלקוח.">
          <div className="space-y-4">
            <MessageMix label="לקוח" value={data.todayMessages.lead} total={messageTotal} />
            <MessageMix label="בוט" value={data.todayMessages.bot} total={messageTotal} />
            <MessageMix label="נציג" value={data.todayMessages.eli} total={messageTotal} />
          </div>
        </Panel>
      </div>
      <Panel title="מצב השאלונים" description="מבט תפעולי על שאלונים פתוחים, שהושלמו או נעצרו.">
        <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border">
            <CompactStat label="פעילים עכשיו" value={formatNumber(data.botQa.activeQuestionnaires)} emphasis />
            <CompactStat label="הושלמו" value={formatNumber(data.botQa.completedQuestionnaires)} />
            <CompactStat label="נפילות" value={formatNumber(data.botQa.bailedQuestionnaires)} danger={data.botQa.bailedQuestionnaires > 0} />
            <CompactStat label="תור אישורים" value={formatNumber(data.pendingDrafts)} />
          </div>
          <div className="rounded-xl border border-border bg-muted/15 p-5">
            <p className="text-xs text-muted-foreground">פעילות נכנסת ב־30 יום</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums">{formatNumber(data.inboundLeadsMonth)}</p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">לידים ייחודיים ששלחו לפחות הודעה אחת בתקופה.</p>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function Panel({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-border bg-card p-4 md:p-6"><div className="mb-5"><h2 className="text-base font-semibold">{title}</h2>{description && <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>}</div>{children}</section>;
}

function HeadlineMetric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="min-h-32 border-l border-b border-border p-4 last:border-l-0 md:border-b-0 md:p-5"><div className="flex items-center gap-2 text-xs text-muted-foreground [&_svg]:size-4 [&_svg]:text-primary">{icon}<span>{label}</span></div><p className="mt-4 text-2xl font-semibold tabular-nums md:text-3xl" style={{ fontFamily: "var(--font-display)" }}>{value}</p></div>;
}

function SignalRow({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "warning" }) {
  return <div className="flex items-center justify-between gap-4 border-t border-border/60 pt-3 first:border-0 first:pt-0"><span className="text-sm text-muted-foreground">{label}</span><span className={cn("text-sm font-semibold tabular-nums", tone === "warning" && "text-warning")}>{value}</span></div>;
}

function Funnel({ rows }: { rows: AnalyticsData["botFunnel"] }) {
  const base = rows[0]?.uniqueLeads ?? 0;
  return (
    <div className="space-y-1">
      {rows.map((row, index) => {
        const rate = percentage(row.uniqueLeads, base);
        const width = Math.max(row.uniqueLeads > 0 ? 2 : 0, rate ?? 0);
        return (
          <div
            key={row.event}
            className="grid grid-cols-[28px_minmax(0,1fr)_54px] items-center gap-3 py-2"
          >
            <span
              className={cn(
                "grid size-7 place-items-center rounded-full border text-xs tabular-nums",
                index === 0
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground"
              )}
            >
              {index + 1}
            </span>
            <div className="min-w-0">
              <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                <span className="truncate">{row.label}</span>
                <span className="text-xs text-muted-foreground">
                  {row.attempts !== row.uniqueLeads ? `${row.attempts} ניסיונות` : ""}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted/50">
                <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
              </div>
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold tabular-nums">{formatNumber(row.uniqueLeads)}</div>
              <div className="text-[11px] text-muted-foreground">{formatPercent(rate)}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OutcomePath({ rows }: { rows: Array<{ label: string; value: number; icon: React.ReactNode }> }) {
  const base = rows[0]?.value ?? 0;
  return <div>{rows.map((row, index) => <div key={row.label} className="relative flex items-center gap-3 pb-5 last:pb-0"><div className="relative z-10 grid size-9 shrink-0 place-items-center rounded-full border border-border bg-background text-primary [&_svg]:size-4">{row.icon}</div>{index < rows.length - 1 && <span className="absolute right-[17px] top-9 h-full w-px bg-border" />}<div className="flex min-w-0 flex-1 items-baseline justify-between gap-3"><span className="text-sm text-muted-foreground">{row.label}</span><span className="text-base font-semibold tabular-nums">{formatNumber(row.value)} <small className="font-normal text-muted-foreground">{formatPercent(percentage(row.value, base))}</small></span></div></div>)}</div>;
}

function Distribution({ rows, emptyLabel = "אין נתונים" }: { rows: Array<{ key?: string; label: string; count: number }>; emptyLabel?: string }) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  if (rows.length === 0 || total === 0) return <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">{emptyLabel}</div>;
  return <div className="space-y-4">{rows.map((row) => { const rate = percentage(row.count, total) ?? 0; return <div key={row.key ?? row.label}><div className="mb-1.5 flex items-center justify-between gap-3 text-sm"><span>{row.label}</span><span className="tabular-nums text-muted-foreground">{formatNumber(row.count)} · {formatPercent(rate)}</span></div><div className="h-1.5 rounded-full bg-muted/50"><div className="h-full rounded-full bg-primary" style={{ width: `${Math.max(row.count > 0 ? 2 : 0, rate)}%` }} /></div></div>; })}</div>;
}

function CompactStat({ label, value, emphasis = false, danger = false }: { label: string; value: string; emphasis?: boolean; danger?: boolean }) {
  return <div className="min-h-24 bg-card p-4"><p className="text-xs leading-5 text-muted-foreground">{label}</p><p className={cn("mt-2 text-xl font-semibold tabular-nums", emphasis && "text-primary", danger && "text-destructive")}>{value}</p></div>;
}

function LargeMetric({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return <div className="flex items-center gap-4 rounded-xl border border-border bg-muted/15 p-5"><div className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5">{icon}</div><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p></div></div>;
}

function ActionMetric({ icon, label, value, href, critical = false }: { icon: React.ReactNode; label: string; value: number; href: string; critical?: boolean }) {
  return <Link href={href} className="group flex min-h-16 items-center gap-3 py-3"><span className={cn("grid size-9 place-items-center rounded-lg bg-muted/40 text-muted-foreground [&_svg]:size-4", critical && "bg-destructive/10 text-destructive")}>{icon}</span><span className="flex-1 text-sm">{label}</span><strong className={cn("text-lg tabular-nums", critical && "text-destructive")}>{formatNumber(value)}</strong><ArrowLeft className="size-4 text-muted-foreground transition-transform group-hover:-translate-x-1" /></Link>;
}

function MessageMix({ label, value, total }: { label: string; value: number; total: number }) {
  const rate = percentage(value, total) ?? 0;
  return <div><div className="mb-1.5 flex justify-between text-sm"><span>{label}</span><span className="tabular-nums text-muted-foreground">{formatNumber(value)} · {formatPercent(rate)}</span></div><div className="h-2 rounded-full bg-muted/50"><div className="h-full rounded-full bg-primary" style={{ width: `${rate}%` }} /></div></div>;
}

function SourceTable({ rows }: { rows: AnalyticsData["sourcePerformance"] }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead><tr className="border-b border-border text-xs text-muted-foreground"><th className="pb-3 text-right font-medium">מקור</th><th className="pb-3 text-left font-medium">לידים</th><th className="pb-3 text-left font-medium">הצעות</th><th className="pb-3 text-left font-medium">נסגרו</th><th className="pb-3 text-left font-medium">המרה</th></tr></thead><tbody className="divide-y divide-border/60">{rows.map((row) => <tr key={row.source}><td className="max-w-52 truncate py-3">{row.source}</td><td className="py-3 text-left tabular-nums">{row.leads}</td><td className="py-3 text-left tabular-nums">{row.quoted}</td><td className="py-3 text-left tabular-nums">{row.won}</td><td className="py-3 text-left tabular-nums text-primary">{formatPercent(percentage(row.won, row.leads))}</td></tr>)}</tbody></table>{rows.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">אין עדיין מספיק נתוני מקור.</p>}</div>;
}

function PipelineChart({ rows }: { rows: AnalyticsData["pipelineDist"] }) {
  const chart = rows.map((row) => ({ ...row, label: STAGE_LABEL[row.stage] ?? row.stage, color: stageColor(row.stage) }));
  return <div className="h-72" dir="ltr"><ResponsiveContainer width="100%" height="100%"><BarChart data={chart} margin={{ top: 8, right: 4, bottom: 8, left: 0 }}><CartesianGrid vertical={false} stroke="oklch(0.3 0.02 270)" /><XAxis dataKey="label" stroke="oklch(0.6 0.02 270)" tick={{ fontSize: 11 }} interval={0} /><YAxis stroke="oklch(0.6 0.02 270)" tick={{ fontSize: 11 }} allowDecimals={false} /><Tooltip contentStyle={{ background: "oklch(0.22 0.02 270)", border: "1px solid oklch(0.3 0.02 270)", borderRadius: 10, fontSize: 12 }} cursor={{ fill: "oklch(0.25 0.02 270 / 0.45)" }} /><Bar dataKey="count" radius={[6, 6, 0, 0]}>{chart.map((entry) => <Cell key={entry.stage} fill={entry.color} />)}</Bar></BarChart></ResponsiveContainer></div>;
}

function formatNumber(value: number): string { return value.toLocaleString("he-IL"); }
function formatPercent(value: number | null): string { return value === null ? "—" : `${value}%`; }
function formatIls(value: number | null): string { return value === null ? "—" : `₪${Math.round(value).toLocaleString("he-IL")}`; }
function formatMinutes(value: number | null): string { if (value === null) return "—"; if (value < 60) return `${Math.round(value)} דק׳`; if (value < 1440) return `${(value / 60).toFixed(1)} שעות`; return `${(value / 1440).toFixed(1)} ימים`; }
function stageColor(stage: string): string { return ({ INTAKE: "#0ea5e9", DISCAVERY: "#06b6d4", FACTORY_WAIT: "#f59e0b", CONSIDERATION: "#f43f5e", WON: "#10b981", LOST: "#64748b" } as Record<string, string>)[stage] ?? "#64748b"; }
