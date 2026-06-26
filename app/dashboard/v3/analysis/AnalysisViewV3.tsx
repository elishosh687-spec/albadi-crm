"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { analyzeBatchAction, loadAnalysisAggregateAction } from "@/app/actions/v2";
import type { LeadFilter } from "@/lib/analysis/batch";
import type { AnalysisAggregate, Pattern } from "@/lib/analysis/aggregate";

const STAGES: [string, string][] = [
  ["__NULL__", "בשאלון"],
  ["INTAKE", "שאלון+הצעה"],
  ["DISCAVERY", "שיחת בירור"],
  ["FACTORY_WAIT", "בדיקת מפעל"],
  ["CONSIDERATION", "שוקל/מו״מ"],
  ["WON", "נסגר"],
  ["LOST", "אבוד"],
  ["FUTURE_FOLLOW_UP", "מעקב עתידי"],
  ["NO_RESPONSE_REENGAGE", "ללא מענה"],
];

/** v3 mirror of the widget "ניתוח לידים" screen — filtered bulk analysis +
 *  deterministic rollup, via server actions. */
export default function AnalysisViewV3() {
  const [stages, setStages] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [withCalls, setWithCalls] = useState(false);
  const [batch, setBatch] = useState(20);

  const [agg, setAgg] = useState<AnalysisAggregate | null>(null);
  const [matched, setMatched] = useState({ total: 0, analyzed: 0 });
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  function filter(): LeadFilter {
    return {
      stages: stages.length ? stages : undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      withCalls,
    };
  }

  async function loadAggregate() {
    setLoading(true);
    setError(null);
    const r = await loadAnalysisAggregateAction(filter());
    if (r.ok) {
      setAgg(r.aggregate);
      setMatched({ total: r.matched_total, analyzed: r.matched_analyzed });
    } else setError(r.error);
    setLoading(false);
  }

  async function runBatch() {
    setRunning(true);
    setError(null);
    const r = await analyzeBatchAction(filter(), batch);
    if (!r.ok) setError(r.error);
    await loadAggregate();
    setRunning(false);
  }

  useEffect(() => {
    loadAggregate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remaining = Math.max(0, matched.total - matched.analyzed);
  const pct = matched.total ? Math.round((matched.analyzed / matched.total) * 100) : 0;

  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-lg border border-border p-3 space-y-3">
        <div>
          <div className="text-xs text-muted-foreground mb-1.5">שלב</div>
          <div className="flex flex-wrap gap-1.5">
            {STAGES.map(([key, label]) => {
              const on = stages.includes(key);
              return (
                <button
                  key={key}
                  onClick={() =>
                    setStages((s) => (on ? s.filter((x) => x !== key) : [...s, key]))
                  }
                  className={cn(
                    "rounded-full px-2.5 py-0.5 text-xs border",
                    on
                      ? "bg-primary/10 border-primary/40 text-primary"
                      : "border-border text-muted-foreground"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            נוצר מ־
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="rounded border border-border bg-background px-2 py-1 text-foreground" />
          </label>
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            עד
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="rounded border border-border bg-background px-2 py-1 text-foreground" />
          </label>
          <label className="text-xs text-muted-foreground flex flex-col gap-1">
            באצ'
            <select value={batch} onChange={(e) => setBatch(Number(e.target.value))} className="rounded border border-border bg-background px-2 py-1 text-foreground">
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={40}>40</option>
            </select>
          </label>
          <label className="text-xs text-muted-foreground flex items-center gap-1.5">
            <input type="checkbox" checked={withCalls} onChange={(e) => setWithCalls(e.target.checked)} />
            רק עם שיחות
          </label>
        </div>

        <div className="flex gap-2">
          <button onClick={loadAggregate} disabled={loading} className="rounded-md border border-border px-3 py-1.5 text-xs">
            {loading ? "טוען…" : "החל סינון"}
          </button>
          <button
            onClick={runBatch}
            disabled={running || remaining === 0}
            className="rounded-md border border-primary/40 bg-primary/10 text-primary px-3 py-1.5 text-xs disabled:opacity-50"
          >
            {running ? "מנתח…" : remaining === 0 ? "הכל נותח ✓" : `נתח ${Math.min(batch, remaining)} מתוך ${remaining}`}
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <div className="flex justify-between text-xs">
          <span>נותחו {matched.analyzed} מתוך {matched.total} בסינון</span>
          <span className="text-muted-foreground">{pct}%</span>
        </div>
        <div className="h-1.5 bg-muted rounded-full mt-1.5 overflow-hidden">
          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {error && <div className="text-destructive">שגיאה: {error}</div>}

      {agg &&
        (agg.conclusive === 0 ? (
          <div className="text-muted-foreground">עוד לא נותחו לידים בסינון הזה — לחץ "נתח".</div>
        ) : (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              מבוסס על {agg.conclusive} ניתוחים · מחויבות ממוצעת {agg.avg_commitment}/5
              {agg.insufficient > 0 && ` · ${agg.insufficient} ללא מספיק דאטה`}
            </div>
            <PatternList title="חסם מרכזי" patterns={agg.by_blocker} denom={agg.conclusive} open={open} setOpen={setOpen} prefix="b" />
            <PatternList title="התנגדויות" patterns={agg.by_objection} denom={agg.conclusive} open={open} setOpen={setOpen} prefix="o" />
            <PatternList
              title="כשלי מעקב ודוגמאות"
              patterns={[agg.followup_failures, agg.sample_gaps].filter((p) => p.count > 0)}
              denom={agg.conclusive}
              open={open}
              setOpen={setOpen}
              prefix="x"
            />
          </div>
        ))}
    </div>
  );
}

function PatternList({
  title,
  patterns,
  denom,
  open,
  setOpen,
  prefix,
}: {
  title: string;
  patterns: Pattern[];
  denom: number;
  open: string | null;
  setOpen: (k: string | null) => void;
  prefix: string;
}) {
  if (!patterns.length) return null;
  return (
    <div className="rounded-lg border border-border p-3 space-y-2">
      <div className="text-xs text-muted-foreground">{title}</div>
      {patterns.map((p) => {
        const id = `${prefix}:${p.key}`;
        const isOpen = open === id;
        const w = denom ? Math.round((p.count / denom) * 100) : 0;
        return (
          <div key={id}>
            <button onClick={() => setOpen(isOpen ? null : id)} className="flex justify-between w-full text-sm">
              <span>
                {isOpen ? "▾" : "▸"} {p.label}
              </span>
              <span className="text-muted-foreground">
                {p.count}/{denom} ({w}%)
              </span>
            </button>
            <div className="h-1 bg-muted rounded-full mt-1 overflow-hidden">
              <div className="h-full bg-primary/50" style={{ width: `${w}%` }} />
            </div>
            {isOpen && (
              <div className="mt-1 text-xs text-muted-foreground">
                {p.leads.map((l) => l.name || l.sid).join(" · ")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
