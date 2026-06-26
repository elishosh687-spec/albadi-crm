"use client";

import { useCallback, useEffect, useState } from "react";
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
export default function AnalysisScreen({ token }: { token: string }) {
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
    <div dir="rtl" style={{ color: "#e4e4e7", fontSize: 13, padding: 12, lineHeight: 1.5 }}>
      <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>🔍 ניתוח לידים</h2>

      {/* Filters */}
      <div style={card}>
        <div style={{ fontSize: 11, color: "#71717a", marginBottom: 6 }}>שלב</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {STAGES.map(([key, label]) => {
            const on = stages.includes(key);
            return (
              <button
                key={key}
                onClick={() =>
                  setStages((s) => (on ? s.filter((x) => x !== key) : [...s, key]))
                }
                style={chip(on)}
              >
                {label}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
          <label style={lbl}>
            נוצר מ־
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={inp} />
          </label>
          <label style={lbl}>
            עד
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={inp} />
          </label>
          <label style={lbl}>
            באצ'
            <select value={batch} onChange={(e) => setBatch(Number(e.target.value))} style={inp}>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={40}>40</option>
            </select>
          </label>
          <label style={{ ...lbl, flexDirection: "row", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={withCalls} onChange={(e) => setWithCalls(e.target.checked)} />
            רק עם שיחות
          </label>
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={loadAggregate} disabled={loading} style={btn("neutral")}>
            {loading ? "טוען…" : "החל סינון"}
          </button>
          <button onClick={runBatch} disabled={running || remaining === 0} style={btn("accent")}>
            {running
              ? "מנתח…"
              : remaining === 0
              ? "הכל נותח ✓"
              : `נתח ${Math.min(batch, remaining)} מתוך ${remaining}`}
          </button>
        </div>
      </div>

      {/* Progress */}
      <div style={{ ...card, marginTop: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
          <span>נותחו {matched.analyzed} מתוך {matched.total} בסינון</span>
          <span style={{ color: "#71717a" }}>{pct}%</span>
        </div>
        <div style={{ height: 6, background: "#17191f", borderRadius: 99, marginTop: 6, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: "#3b82f6" }} />
        </div>
        {remaining > 0 && !running && (
          <button onClick={runBatch} style={{ ...btn("accent"), marginTop: 8 }}>
            המשך לנתח עוד {Math.min(batch, remaining)}
          </button>
        )}
      </div>

      {error && <div style={{ color: "#fecaca", marginTop: 10 }}>שגיאה: {error}</div>}

      {/* Aggregate */}
      {agg && (
        <div style={{ marginTop: 12 }}>
          {agg.conclusive === 0 ? (
            <div style={{ color: "#71717a" }}>
              עוד לא נותחו לידים בסינון הזה — לחץ "נתח" כדי להתחיל.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 12, color: "#71717a", marginBottom: 8 }}>
                מבוסס על {agg.conclusive} ניתוחים · מחויבות ממוצעת {agg.avg_commitment}/5
                {agg.insufficient > 0 && ` · ${agg.insufficient} ללא מספיק דאטה`}
              </div>

              <PatternList
                title="חסם מרכזי"
                patterns={agg.by_blocker}
                denom={agg.conclusive}
                open={openPattern}
                setOpen={setOpenPattern}
                prefix="b"
              />
              <PatternList
                title="התנגדויות"
                patterns={agg.by_objection}
                denom={agg.conclusive}
                open={openPattern}
                setOpen={setOpenPattern}
                prefix="o"
              />
              <PatternList
                title="מעקב ובקשות לראות מוצר"
                patterns={[agg.followup_failures, agg.sample_gaps].filter((p) => p.count > 0)}
                denom={agg.conclusive}
                open={openPattern}
                setOpen={setOpenPattern}
                prefix="x"
              />
            </>
          )}
        </div>
      )}
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
    <div style={{ ...card, marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: "#71717a", marginBottom: 6 }}>{title}</div>
      {patterns.map((p) => {
        const id = `${prefix}:${p.key}`;
        const isOpen = open === id;
        const w = denom ? Math.round((p.count / denom) * 100) : 0;
        return (
          <div key={id} style={{ marginBottom: 6 }}>
            <button
              onClick={() => setOpen(isOpen ? null : id)}
              style={{
                display: "flex",
                justifyContent: "space-between",
                width: "100%",
                background: "transparent",
                border: "none",
                color: "#e4e4e7",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 13,
                padding: 0,
              }}
            >
              <span>
                {isOpen ? "▾" : "▸"} {p.label}
              </span>
              <span style={{ color: "#a1a1aa" }}>
                {p.count}/{denom} ({w}%)
              </span>
            </button>
            <div style={{ height: 4, background: "#17191f", borderRadius: 99, marginTop: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${w}%`, background: "#2f4a6e" }} />
            </div>
            {isOpen && (
              <div style={{ marginTop: 4, color: "#a1a1aa", fontSize: 12 }}>
                {p.leads.map((l) => l.name || l.sid).join(" · ")}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const card: React.CSSProperties = {
  background: "#0d0f14",
  border: "1px solid #2a2d34",
  borderRadius: 8,
  padding: 10,
};
const lbl: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 3,
  fontSize: 11,
  color: "#71717a",
};
const inp: React.CSSProperties = {
  background: "#17191f",
  border: "1px solid #2a2d34",
  borderRadius: 6,
  color: "#e4e4e7",
  padding: "4px 6px",
  fontFamily: "inherit",
  fontSize: 13,
};
function chip(on: boolean): React.CSSProperties {
  return {
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 99,
    cursor: "pointer",
    fontFamily: "inherit",
    background: on ? "#1a2638" : "transparent",
    border: `1px solid ${on ? "#2f4a6e" : "#2a2d34"}`,
    color: on ? "#dbeafe" : "#a1a1aa",
  };
}
function btn(tone: "accent" | "neutral"): React.CSSProperties {
  return {
    padding: "8px 14px",
    borderRadius: 8,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 13,
    border: `1px solid ${tone === "accent" ? "#2f4a6e" : "#2a2d34"}`,
    background: tone === "accent" ? "#1a2638" : "transparent",
    color: tone === "accent" ? "#dbeafe" : "#a1a1aa",
  };
}
