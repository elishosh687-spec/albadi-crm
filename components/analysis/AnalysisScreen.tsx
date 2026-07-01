"use client";

import { useCallback, useEffect, useState } from "react";
import type { AnalysisAggregate, Pattern } from "@/lib/analysis/aggregate";
import PlaysEditor from "./PlaysEditor";
import PipelineAuditSection from "./PipelineAuditSection";
import type { BlockerKey, StagePlay } from "@/lib/sales/stage-plays.he";
import { LuxShell, LuxTitle, LuxAccent } from "@/components/widget-ui/lux";

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
    <LuxShell>
      <LuxTitle
        overline="— Lead analysis"
        subtitle="מה חוסם, מה מתנגד, ומי לא חזר אחרי פולואפ — מבוסס נתוחי ליד."
        aside={
          <button onClick={() => setShowEditor((s) => !s)} style={btn("neutral")}>
            {showEditor ? "→ חזרה לניתוח" : "✏️ ערוך פליז"}
          </button>
        }
      >
        למה לידים <LuxAccent>לא נסגרים.</LuxAccent>
      </LuxTitle>

      {showEditor ? (
        <PlaysEditor load={loadPlays} save={savePlays} />
      ) : (
        <>
      <PipelineAuditSection token={token} />
      {/* Filters */}
      <div style={card}>
        <div style={{ fontSize: 11, color: "#8f939b", marginBottom: 6 }}>שלב</div>
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
          <span style={{ color: "#8f939b" }}>{pct}%</span>
        </div>
        <div style={{ height: 6, background: "rgba(255,255,255,0.05)", borderRadius: 99, marginTop: 6, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: "#cda978" }} />
        </div>
        {remaining > 0 && !running && (
          <button onClick={runBatch} style={{ ...btn("accent"), marginTop: 8 }}>
            המשך לנתח עוד {Math.min(batch, remaining)}
          </button>
        )}
      </div>

      {error && <div style={{ color: "#f0b4b4", marginTop: 10 }}>שגיאה: {error}</div>}

      {/* Aggregate */}
      {agg && (
        <div style={{ marginTop: 12 }}>
          {agg.conclusive === 0 ? (
            <div style={{ color: "#8f939b" }}>
              עוד לא נותחו לידים בסינון הזה — לחץ "נתח" כדי להתחיל.
            </div>
          ) : (
            <>
              {/* Stripe-style KPI cards — promoted from the old summary line */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(108px, 1fr))",
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <Kpi label="נותחו" value={`${agg.conclusive}`} />
                <Kpi label="מחויבות ממוצעת" value={`${agg.avg_commitment}/5`} />
                <Kpi label="נשירת פולואפ" value={`${agg.followup_failures.count}`} tone="warn" />
                <Kpi label="ללא מספיק דאטה" value={`${agg.insufficient}`} />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1.2fr 1fr",
                  gap: 14,
                  alignItems: "start",
                }}
              >
                <PatternList
                  title="חסם מרכזי"
                  patterns={agg.by_blocker}
                  denom={agg.conclusive}
                  open={openPattern}
                  setOpen={setOpenPattern}
                  prefix="b"
                />
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
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
                </div>
              </div>
            </>
          )}
        </div>
      )}
        </>
      )}
    </LuxShell>
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
  const max = Math.max(...patterns.map((p) => p.count), 1);
  return (
    <div style={{ ...card }}>
      <div
        className="lux-label"
        style={{
          marginBottom: 16,
          letterSpacing: "0.16em",
        }}
      >
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {patterns.map((p) => {
          const id = `${prefix}:${p.key}`;
          const isOpen = open === id;
          const pct = denom ? Math.round((p.count / denom) * 100) : 0;
          const barW = Math.round((p.count / max) * 100);
          return (
            <div key={id}>
              <button
                onClick={() => setOpen(isOpen ? null : id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  width: "100%",
                  minHeight: 32,
                  background: "transparent",
                  border: "none",
                  color: "#f5f6f7",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  fontSize: 13,
                  padding: 0,
                  textAlign: "right",
                }}
              >
                <span style={{ color: "#6b7079", fontSize: 11, width: 12 }}>
                  {isOpen ? "▾" : "▸"}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>{p.label}</span>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#e7cba6",
                    background: "rgba(205,169,120,0.14)",
                    boxShadow: "inset 0 0 0 1px rgba(205,169,120,0.30)",
                    borderRadius: 6,
                    padding: "1px 8px",
                    whiteSpace: "nowrap",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {p.count} · {pct}%
                </span>
              </button>
              {/* proportional bar (relative to the biggest pattern in the group) */}
              <div
                style={{
                  height: 5,
                  background: "rgba(255,255,255,0.06)",
                  borderRadius: 99,
                  marginTop: 6,
                  marginInlineStart: 20,
                  overflow: "hidden",
                }}
              >
                <div style={{ height: "100%", width: `${barW}%`, background: "#cda978" }} />
              </div>
              {isOpen && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 5,
                    marginTop: 8,
                    marginInlineStart: 20,
                  }}
                >
                  {p.leads.map((l) => (
                    <span key={l.sid} style={chipLead}>
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
    <div
      style={{
        background: "#1d1b1a",
        borderRadius: 9,
        padding: "13px 15px",
        boxShadow: tone === "warn"
          ? "inset 0 0 0 1px rgba(224,169,109,0.2)"
          : "inset 0 0 0 1px rgba(69,70,77,0.16)",
      }}
    >
      <div style={{ fontSize: 10.5, color: "#8a7f74", marginBottom: 4 }}>{label}</div>
      <div
        style={{
          fontFamily: "var(--font-body), Heebo, system-ui",
          fontWeight: 300,
          fontSize: 24,
          color: tone === "warn" ? "#e0a96d" : "#e6e1e0",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
    </div>
  );
}

const chipLead: React.CSSProperties = {
  fontSize: 11.5,
  padding: "3px 9px",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 6,
  color: "#d4d6da",
  whiteSpace: "nowrap",
};

const card: React.CSSProperties = {
  background: "#1d1b1a",
  borderRadius: 8,
  padding: "18px 20px",
  boxShadow: "inset 0 0 0 1px rgba(69,70,77,0.16)",
};
const lbl: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 5,
  fontSize: 11,
  color: "#8a7f74",
};
const inp: React.CSSProperties = {
  background: "#211f1e",
  border: 0,
  boxShadow: "inset 0 0 0 1px rgba(69,70,77,0.18)",
  borderRadius: 4,
  color: "#c6c6cd",
  padding: "8px 12px",
  fontFamily: "inherit",
  fontSize: 12,
};
function chip(on: boolean): React.CSSProperties {
  return {
    fontSize: 12,
    padding: "5px 12px",
    borderRadius: 99,
    cursor: "pointer",
    fontFamily: "inherit",
    background: on ? "rgba(205,169,120,0.14)" : "transparent",
    border: 0,
    boxShadow: `inset 0 0 0 1px ${on ? "rgba(205,169,120,0.30)" : "rgba(69,70,77,0.22)"}`,
    color: on ? "#e7cba6" : "#8a7f74",
  };
}
function btn(tone: "accent" | "neutral"): React.CSSProperties {
  return {
    padding: "9px 15px",
    borderRadius: 8,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 12,
    border: 0,
    boxShadow: `inset 0 0 0 1px ${tone === "accent" ? "rgba(205,169,120,0.30)" : "rgba(69,70,77,0.22)"}`,
    background: tone === "accent" ? "rgba(205,169,120,0.14)" : "transparent",
    color: tone === "accent" ? "#e7cba6" : "#8a7f74",
  };
}
