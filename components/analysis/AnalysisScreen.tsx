"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ChevronDown, SlidersHorizontal, WandSparkles } from "lucide-react";
import type { AnalysisAggregate, Pattern } from "@/lib/analysis/aggregate";
import PlaysEditor from "./PlaysEditor";
import PipelineAuditSection from "./PipelineAuditSection";
import FormGapsSection from "./FormGapsSection";
import InfoTip from "./InfoTip";
import type { BlockerKey, StagePlay } from "@/lib/sales/stage-plays.he";
import { cn } from "@/lib/cn";

const STAGES: [string, string][] = [
  ["__NULL__", "בשאלון"],
  ["INTAKE", "קליטה"],
  ["DISCAVERY", "אפיון"],
  ["FACTORY_WAIT", "מחכה למפעל"],
  ["CONSIDERATION", "שוקל / משא ומתן"],
  ["WON", "נסגר"],
  ["LOST", "אבוד"],
  ["FUTURE_FOLLOW_UP", "להתקשר בעתיד"],
  ["NO_RESPONSE_REENGAGE", "לא ענו"],
];

interface AggResp {
  ok: boolean;
  aggregate?: AnalysisAggregate;
  matched_total?: number;
  matched_analyzed?: number;
  error?: string;
}

/**
 * Filtered bulk-analysis screen. Pick stage/date/batch → run analysis on the
 * matched set (chunked, with a "המשך" button) → read the deterministic rollup
 * of why those leads aren't closing. The rollup is a pure groupby over stored
 * verdicts, so every number carries its exact supporting lead list.
 */
export default function AnalysisScreen({
  token,
  embedded = false,
}: {
  token: string;
  embedded?: boolean;
}) {
  const [stages, setStages] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [withCalls, setWithCalls] = useState(false);
  const [batch, setBatch] = useState(20);

  const [showEditor, setShowEditor] = useState(false);
  const [agg, setAgg] = useState<AnalysisAggregate | null>(null);
  const [matched, setMatched] = useState({ total: 0, analyzed: 0 });

  const loadPlays = useCallback(async () => {
    const r = await fetch(`/api/widget/plays?widget_token=${encodeURIComponent(token)}`);
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || "failed");
    return j.plays as Record<BlockerKey, StagePlay>;
  }, [token]);

  const savePlays = useCallback(
    async (plays: Record<BlockerKey, StagePlay>) => {
      const r = await fetch(`/api/widget/plays?widget_token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plays }),
      });
      const j = await r.json();
      return { ok: !!j.ok, error: j.error as string | undefined };
    },
    [token]
  );
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openPattern, setOpenPattern] = useState<string | null>(null);

  const qs = useCallback(() => {
    const p = new URLSearchParams({ widget_token: token });
    if (stages.length) p.set("stages", stages.join(","));
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    if (withCalls) p.set("withCalls", "1");
    return p.toString();
  }, [token, stages, dateFrom, dateTo, withCalls]);

  const loadAggregate = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/widget/analysis-aggregate?${qs()}`);
      const json: AggResp = await res.json();
      if (!json.ok) throw new Error(json.error || "failed");
      setAgg(json.aggregate ?? null);
      setMatched({ total: json.matched_total ?? 0, analyzed: json.matched_analyzed ?? 0 });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [qs]);

  useEffect(() => {
    loadAggregate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runBatch() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/widget/analyze-batch?widget_token=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            stages: stages.length ? stages : undefined,
            dateFrom: dateFrom || undefined,
            dateTo: dateTo || undefined,
            withCalls,
            limit: batch,
          }),
        }
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "batch failed");
      await loadAggregate();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  const remaining = Math.max(0, matched.total - matched.analyzed);
  const pct = matched.total ? Math.round((matched.analyzed / matched.total) * 100) : 0;

  return (
    <div className={cn("space-y-5", !embedded && "mx-auto max-w-[1420px] pb-16")}>
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-medium tracking-[0.14em] text-primary">אבחון מבוסס שיחות והתכתבויות</p>
          <h3 className="mt-1 text-xl font-semibold">למה לידים לא נסגרים</h3>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
            מוצא לידים שנשכחו, פערי שלב וחסמים חוזרים. כל מספר נפתח לרשימת הלידים שמאחוריו.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowEditor((state) => !state)}
          className="min-h-11 rounded-xl border border-border bg-background/40 px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {showEditor ? "חזרה לאבחון" : "עריכת תסריטי מכירה"}
        </button>
      </div>

      {showEditor ? (
        <div className="rounded-2xl border border-border bg-card p-5">
          <PlaysEditor load={loadPlays} save={savePlays} />
        </div>
      ) : (
        <>
          <PipelineAuditSection token={token} />
          <FormGapsSection token={token} />

          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-5 flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted/50 text-muted-foreground">
                <SlidersHorizontal className="size-4" />
              </span>
              <div>
                <h3 className="text-sm font-semibold">קבוצת הלידים לניתוח</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  הסינון משנה גם את הסיכום וגם את הבאצ׳ הבא. הרצת ניתוח חדש משתמשת ב־LLM ועולה כסף.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {STAGES.map(([key, label]) => {
                const active = stages.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setStages((current) => active ? current.filter((item) => item !== key) : [...current, key])}
                    className={cn(
                      "min-h-11 rounded-full border px-4 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      active
                        ? "border-primary/40 bg-primary/15 text-primary"
                        : "border-border bg-background/30 text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_140px_auto] lg:items-end">
              <FilterField label="נוצר מתאריך">
                <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className={controlClass} />
              </FilterField>
              <FilterField label="עד תאריך">
                <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className={controlClass} />
              </FilterField>
              <FilterField label="גודל באצ׳">
                <select value={batch} onChange={(event) => setBatch(Number(event.target.value))} className={controlClass}>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={40}>40</option>
                </select>
              </FilterField>
              <label className="flex min-h-11 items-center gap-2 rounded-xl border border-border bg-background/30 px-3 text-sm text-muted-foreground">
                <input type="checkbox" checked={withCalls} onChange={(event) => setWithCalls(event.target.checked)} className="size-4 accent-[var(--primary)]" />
                רק עם שיחות
              </label>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={loadAggregate} disabled={loading} className={secondaryButtonClass}>
                {loading ? "מרענן…" : "החל סינון"}
              </button>
              <button type="button" onClick={runBatch} disabled={running || remaining === 0} className={primaryButtonClass}>
                <WandSparkles className="size-4" />
                {running ? "מנתח…" : remaining === 0 ? "הכול נותח" : `נתח ${Math.min(batch, remaining)} מתוך ${remaining}`}
              </button>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-4 text-sm">
              <div>
                <span className="font-medium">כיסוי הניתוח</span>
                <span className="mr-2 text-muted-foreground">{matched.analyzed} מתוך {matched.total} לידים</span>
              </div>
              <strong className="tabular-nums text-primary">{pct}%</strong>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${pct}%` }} />
            </div>
            {remaining > 0 && !running && (
              <button type="button" onClick={runBatch} className={cn(primaryButtonClass, "mt-4")}>
                המשך לנתח עוד {Math.min(batch, remaining)}
              </button>
            )}
          </section>

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              שגיאה: {error}
            </div>
          )}

          {agg && (agg.conclusive === 0 ? (
            <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              עוד לא נותחו לידים בסינון הזה. אפשר להתחיל מהכפתור למעלה.
            </div>
          ) : (
            <section className="space-y-5">
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border lg:grid-cols-4">
                <Kpi label="נותחו" value={`${agg.conclusive}`} />
                <Kpi label="מחויבות ממוצעת" value={`${agg.avg_commitment}/5`} />
                <Kpi label="נשירת פולואפ" value={`${agg.followup_failures.count}`} tone="warn" />
                <Kpi label="ללא מספיק מידע" value={`${agg.insufficient}`} />
              </div>
              <div className="grid items-start gap-5 xl:grid-cols-[1.15fr_0.85fr]">
                <PatternList title="חסם מרכזי" info={<>הסיבה המרכזית שכל ליד תקוע. לחיצה פותחת את רשימת הלידים.</>} patterns={agg.by_blocker} denom={agg.conclusive} open={openPattern} setOpen={setOpenPattern} prefix="b" />
                <div className="space-y-5">
                  <PatternList title="התנגדויות" info={<>התנגדויות שעלו בפועל בשיחות ובהתכתבויות. ליד יכול להופיע ביותר מקבוצה אחת.</>} patterns={agg.by_objection} denom={agg.conclusive} open={openPattern} setOpen={setOpenPattern} prefix="o" />
                  <PatternList title="מעקב ובקשות לראות מוצר" info={<>נשירת פולואפ מחושבת מהנתונים; בקשה לראות מוצר היא סיגנל לטיפול ולא כישלון.</>} patterns={[agg.followup_failures, agg.sample_gaps].filter((pattern) => pattern.count > 0)} denom={agg.conclusive} open={openPattern} setOpen={setOpenPattern} prefix="x" />
                </div>
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function PatternList({
  title,
  info,
  patterns,
  denom,
  open,
  setOpen,
  prefix,
}: {
  title: string;
  info?: React.ReactNode;
  patterns: Pattern[];
  denom: number;
  open: string | null;
  setOpen: (k: string | null) => void;
  prefix: string;
}) {
  if (!patterns.length) return null;
  const max = Math.max(...patterns.map((p) => p.count), 1);
  const titleEl = <h3 className="text-sm font-semibold">{title}</h3>;
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="mb-5">
        {info ? (
          <InfoTip gap={6} info={info}>
            {titleEl}
          </InfoTip>
        ) : (
          titleEl
        )}
      </div>
      <div className="space-y-4">
        {patterns.map((p) => {
          const id = `${prefix}:${p.key}`;
          const isOpen = open === id;
          const pct = denom ? Math.round((p.count / denom) * 100) : 0;
          const barW = Math.round((p.count / max) * 100);
          return (
            <div key={id} className="rounded-xl border border-transparent p-1 transition-colors hover:border-border/70">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : id)}
                aria-expanded={isOpen}
                className="flex min-h-11 w-full items-center gap-3 rounded-lg text-right text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
                <span className="min-w-0 flex-1">{p.label}</span>
                <span className="whitespace-nowrap rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold tabular-nums text-primary">
                  {p.count} · {pct}%
                </span>
              </button>
              <div className="mr-7 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary/70" style={{ width: `${barW}%` }} />
              </div>
              {isOpen && (
                <div className="mr-7 mt-3 flex flex-wrap gap-2">
                  {p.leads.map((l) => (
                    <span key={l.sid} className="rounded-lg border border-border bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground">
                      {leadLabel(l)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function leadLabel(l: { name: string | null; sid: string }): string {
  if (l.name && l.name.trim()) return l.name.trim();
  const at = l.sid.indexOf("@");
  return at > 0 ? l.sid.slice(0, at) : l.sid;
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className="bg-card p-5">
      <div className="mb-2 text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-2xl font-semibold tabular-nums", tone === "warn" && "text-warning")}>
        {value}
      </div>
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

const controlClass = "min-h-11 w-full rounded-xl border border-border bg-background/40 px-3 text-base text-foreground outline-none transition-colors focus:border-primary";
const primaryButtonClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition-transform active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButtonClass = "inline-flex min-h-11 items-center justify-center rounded-xl border border-border bg-background/40 px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted/60 disabled:opacity-50";
