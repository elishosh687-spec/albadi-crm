"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle, ArrowLeft, Bot, CheckCircle2, CircleDollarSign,
  Clock3, Inbox, MessageSquare, PhoneCall, Search, Target,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { funnelSteps, percentage } from "@/lib/analytics/funnel";
import { groupByLabel, sourceLabel, stageLabel } from "@/lib/analytics/labels";
import { syncHubUrl } from "@/lib/widget/hub-link";
import { LuxShell, LuxTitle, LuxAccent } from "@/components/widget-ui/lux";
import {
  LIFECYCLE_LABEL, PRIORITY_LABEL, type LifecycleKey, type PriorityBand,
} from "@/lib/crm/insights";
import { SalesTargetsForm } from "./SalesTargetsForm";
import AnalysisScreen from "@/components/analysis/AnalysisScreen";

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

type ViewKey = "sales" | "diagnosis" | "operations" | "bot";
const VIEWS: Array<{ key: ViewKey; label: string }> = [
  { key: "sales", label: "משפך ומכירות" },
  { key: "diagnosis", label: "אבחון לידים" },
  { key: "operations", label: "תפעול ו־SLA" },
  { key: "bot", label: "בריאות הבוט" },
];

export function AnalyticsView({ data }: { data: AnalyticsData }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view");
  const initialView = VIEWS.some((item) => item.key === requestedView)
    ? (requestedView as ViewKey)
    : "sales";
  const [view, setView] = useState<ViewKey>(initialView);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [router]);
  const quoted = data.botFunnel.find((row) => row.event === "quote_sent")?.uniqueLeads ?? 0;
  const replied = data.botFunnel.find((row) => row.event === "post_quote_reply")?.uniqueLeads ?? 0;
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
  const widgetToken = searchParams.get("widget_token") ?? "";
  const widgetHub = (tab: string) =>
    `/widget/hub?widget_token=${encodeURIComponent(widgetToken)}&tab=${tab}`;
  const links = pathname.startsWith("/widget/")
    ? { leads: widgetHub("inbox"), factory: widgetHub("factory") }
    : { leads: "/dashboard/v3/leads", factory: "/dashboard/v3/factory" };
  function selectView(next: ViewKey) {
    setView(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "sales") params.delete("view");
    else params.set("view", next);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    syncHubUrl({ view: next === "sales" ? null : next });
  }

  // "3 things to handle" — each from a real number, each with a way to act.
  const lossTotal = data.lossReasons.reduce((sum, row) => sum + row.count, 0);
  const lossUnrecorded = data.lossReasons.find((row) => row.key === "UNRECORDED")?.count ?? 0;
  const lossUnrecordedPct = percentage(lossUnrecorded, lossTotal);
  const median = data.salesOutcomes.medianHumanResponseMinutes;
  const updated = new Date(data.generatedAt).toLocaleString("he-IL", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem" });

  return (
    <LuxShell className="ux">
      <LuxTitle
        overline="— Performance"
        subtitle={<>מתעדכן כל דקה · עודכן {updated}</>}
        aside={
          <span className="ux-chip" role="status">
            <span className="ux-dot" data-tone={data.dataHealth?.status === "healthy" ? undefined : data.dataHealth ? "bad" : "warn"} aria-hidden />
            {healthLabel}
          </span>
        }
      >
        מהליד ועד <LuxAccent>העסקה.</LuxAccent>
      </LuxTitle>

      <div className="ux-kpis">
        <Kpi k="לידים חדשים השבוע" v={formatNumber(data.newLeadsWeek)} e="נכנסו מכל המקורות" />
        <Kpi k="הגיבו אחרי המחיר" v={formatNumber(data.salesOutcomes.replied)} e={quoted > 0 ? <><b>{formatPercent(percentage(replied, quoted))}</b> מאלה שקיבלו מחיר</> : "עוד לא נשלח מחיר"} />
        <Kpi k="נסגרו" v={formatNumber(data.salesOutcomes.closed)} e={data.salesOutcomes.replied > 0 ? <><b>{formatPercent(percentage(data.salesOutcomes.closed, data.salesOutcomes.replied))}</b> מאלה שהגיבו</> : "—"} />
        <Kpi k="הכנסות החודש" v={formatIls(data.wonMonthSumIls)} e={data.wonMonthSumIls > 0 ? "עסקאות שנסגרו החודש" : "עוד לא נסגרה עסקה החודש"} />
      </div>

      <div className="ux-sechead"><h2>שלושה דברים לבדוק</h2></div>
      <div className="ux-alerts">
        <Alert
          ok={classificationRate !== null && classificationRate >= 50}
          title="סיווג לידים"
          big={totalQuality === 0 ? "—" : formatNumber(unclassified)}
          text={totalQuality === 0 ? "אין עדיין לידים לסיווג." : `לידים בלי סיווג איכות, מתוך ${formatNumber(totalQuality)}.`}
          how="בלי סיווג אי אפשר לדעת איזה מקור מביא לידים טובים."
          action={{ label: "לאבחון לידים", onClick: () => selectView("diagnosis") }}
        />
        <Alert
          ok={lossUnrecordedPct === null || lossUnrecordedPct < 50}
          title="הפסדים בלי סיבה"
          big={formatPercent(lossUnrecordedPct)}
          text={lossTotal === 0 ? "אין עדיין עסקאות אבודות." : `${formatNumber(lossUnrecorded)} מתוך ${formatNumber(lossTotal)} עסקאות אבודות נסגרו בלי סיבה.`}
          how="בלי סיבה אי אפשר לדעת אם הבעיה היא מחיר, תזמון או התאמה."
          action={{ label: "לרשימת הלידים", href: links.leads }}
        />
        <Alert
          ok={median !== null && median <= 120}
          title="זמן מענה של נציג"
          big={formatMinutes(median)}
          text="חציון מהצעת המחיר ועד שנציג חוזר ללקוח."
          how={`ממוצע ניסיונות מעקב: ${data.salesOutcomes.avgFollowups === null ? "—" : data.salesOutcomes.avgFollowups.toFixed(1)} לליד.`}
          action={{ label: "לתור העבודה", onClick: () => selectView("operations") }}
        />
      </div>

      <div className="ux-tabs" role="tablist" aria-label="תחומי אנליטיקה">
        {VIEWS.map((item) => (
          <button key={item.key} type="button" role="tab" aria-selected={view === item.key} onClick={() => selectView(item.key)}>
            {item.label}
          </button>
        ))}
      </div>

      {view === "sales" && <SalesView data={data} />}
      {view === "diagnosis" && (
        <div role="tabpanel" className="space-y-5">
          <div className="flex items-start gap-3 rounded-2xl border border-border bg-card p-5">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Search className="size-5" />
            </span>
            <div>
              <h2 className="text-base font-semibold">אבחון לידים</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                בקרת פייפליין, לידים שנשכחו וניתוח החסמים — באותו מסך ובאותה שפה של האנליטיקה.
              </p>
            </div>
          </div>
          <AnalysisScreen token={widgetToken} embedded />
        </div>
      )}
      {view === "operations" && <OperationsView data={data} links={links} />}
      {view === "bot" && <BotHealthView data={data} />}
    </LuxShell>
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

function OperationsView({
  data,
  links,
}: {
  data: AnalyticsData;
  links: { leads: string; factory: string };
}) {
  return (
    <div role="tabpanel" className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
        <Panel title="תור העבודה עכשיו" description="המספרים שדורשים פעולה של נציג, לא רק מעקב.">
          <div className="divide-y divide-border/60">
            <ActionMetric icon={<Inbox />} label="דורש אדם" value={data.operations.needsHuman} href={links.leads} critical={data.operations.needsHuman > 0} />
            <ActionMetric icon={<AlertTriangle />} label="ללא פעילות מעל 48 שעות" value={data.operations.staleActiveLeads} href={links.leads} critical={data.operations.staleActiveLeads > 0} />
            <ActionMetric icon={<Bot />} label="בוט מושעה" value={data.operations.pausedLeads} href={links.leads} />
            <ActionMetric icon={<CircleDollarSign />} label="ממתינים לתמחור ידני" value={data.operations.manualReviewLeads} href={links.factory} />
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
  return <section className="ux-panel"><h2>{title}</h2>{description ? <p className="d">{description}</p> : <div style={{ height: 12 }} />}{children}</section>;
}

function Kpi({ k, v, e }: { k: string; v: string; e: React.ReactNode }) {
  return <div className="ux-kpi"><div className="k">{k}</div><div className="v">{v}</div><div className="e">{e}</div></div>;
}

function Alert({ ok, title, big, text, how, action }: { ok: boolean; title: string; big: string; text: string; how: string; action: { label: string; href?: string; onClick?: () => void } }) {
  return (
    <div className="ux-alert">
      <div className={cn("top", ok && "ok")}>{ok ? <CheckCircle2 className="size-4" aria-hidden /> : <AlertTriangle className="size-4" aria-hidden />}{title}{ok ? " · תקין" : ""}</div>
      <div className="big">{big}</div>
      <div className="txt">{text}</div>
      <div className="how">{how}</div>
      {action.href ? (
        <a href={action.href} target="_parent">{action.label} <ArrowLeft className="size-4" aria-hidden /></a>
      ) : (
        <a href="#" role="button" onClick={(e) => { e.preventDefault(); action.onClick?.(); }}>{action.label} <ArrowLeft className="size-4" aria-hidden /></a>
      )}
    </div>
  );
}

function Funnel({ rows }: { rows: AnalyticsData["botFunnel"] }) {
  const steps = funnelSteps(rows);
  const measured = steps.filter((s) => !s.empty);
  const empty = steps.filter((s) => s.empty);
  const worst = steps.find((s) => s.worst);
  const summary = `משפך הבוט: ${measured.map((s) => `${s.label} ${s.uniqueLeads}`).join(", ")}.${worst ? ` הנפילה הגדולה: ${worst.label}, ${worst.dropPct} אחוז.` : ""}`;
  return (
    <div className="ux-funnel" role="img" aria-label={summary}>
      {measured.map((s) => (
        <div key={s.event} className="ux-fs" data-worst={s.worst || undefined}>
          <span>{s.label}{s.worst && <span className="tag">הנפילה הגדולה</span>}</span>
          <div className="track"><div className="fill" style={{ width: `${Math.max(2, Math.min(100, s.ofStart ?? 0))}%` }} /></div>
          <span className="val">
            {formatNumber(s.uniqueLeads)}
            <small>{s.dropPct !== null ? `−${s.dropPct}%` : s.attempts !== s.uniqueLeads ? `${formatNumber(s.attempts)} ניסיונות` : " "}</small>
          </span>
        </div>
      ))}
      {empty.length > 0 && (
        <div className="ux-fs" data-empty>
          <span>{empty.length === 1 ? empty[0].label : `${empty.length} שלבים נוספים`}</span>
          <div className="track" />
          <span className="val">אין נתונים</span>
        </div>
      )}
      {empty.length > 1 && <p className="ux-note">{empty.map((s) => s.label).join(" · ")} — לא נרשם אף אירוע, לכן הם לא מוצגים כ־0%.</p>}
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
  return <Link href={href} target={href.startsWith("/widget/hub") ? "_parent" : undefined} className="group flex min-h-16 items-center gap-3 py-3 text-foreground"><span className={cn("grid size-9 place-items-center rounded-lg bg-muted/40 text-muted-foreground [&_svg]:size-4", critical && "bg-destructive/10 text-destructive")}>{icon}</span><span className="flex-1 text-sm">{label}</span><strong className={cn("text-lg tabular-nums", critical && "text-destructive")}>{formatNumber(value)}</strong><ArrowLeft className="size-4 text-muted-foreground transition-transform group-hover:-translate-x-1" /></Link>;
}

function MessageMix({ label, value, total }: { label: string; value: number; total: number }) {
  const rate = percentage(value, total) ?? 0;
  return <div><div className="mb-1.5 flex justify-between text-sm"><span>{label}</span><span className="tabular-nums text-muted-foreground">{formatNumber(value)} · {formatPercent(rate)}</span></div><div className="h-2 rounded-full bg-muted/50"><div className="h-full rounded-full bg-primary" style={{ width: `${rate}%` }} /></div></div>;
}

function SourceTable({ rows }: { rows: AnalyticsData["sourcePerformance"] }) {
  if (rows.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">אין עדיין מספיק נתוני מקור.</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table className="ux-table">
        <caption className="ux-sr">לידים, הצעות, עסקאות והמרה לפי מקור</caption>
        <thead><tr><th scope="col">מקור</th><th scope="col" className="n">לידים</th><th scope="col" className="n">הצעות</th><th scope="col" className="n">נסגרו</th><th scope="col" className="n">המרה</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.source}>
              <td>{sourceLabel(row.source)}</td>
              <td className="n">{formatNumber(row.leads)}</td>
              <td className="n">{formatNumber(row.quoted)}</td>
              <td className="n">{formatNumber(row.won)}</td>
              <td className="n">{formatPercent(percentage(row.won, row.leads))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PipelineChart({ rows }: { rows: AnalyticsData["pipelineDist"] }) {
  const grouped = groupByLabel(rows, (row) => stageLabel(row.stage));
  const max = Math.max(1, ...grouped.map((g) => g.count));
  if (grouped.length === 0) return <p className="py-10 text-center text-sm text-muted-foreground">אין לידים פעילים.</p>;
  return (
    <div className="ux-hbars">
      {grouped.map((g) => (
        <div key={g.label} className="ux-hbar">
          <span>{g.label}</span>
          <div className="track" aria-hidden><div className="fill" style={{ width: `${Math.max(2, (g.count / max) * 100)}%` }} /></div>
          <span className="n">{formatNumber(g.count)}</span>
        </div>
      ))}
    </div>
  );
}

function formatNumber(value: number): string { return value.toLocaleString("he-IL"); }
function formatPercent(value: number | null): string { return value === null ? "—" : `${value}%`; }
function formatIls(value: number | null): string { return value === null ? "—" : `₪${Math.round(value).toLocaleString("he-IL")}`; }
function formatMinutes(value: number | null): string { if (value === null) return "—"; if (value < 60) return `${Math.round(value)} דק׳`; if (value < 1440) return `${(value / 60).toFixed(1)} שעות`; return `${(value / 1440).toFixed(1)} ימים`; }
