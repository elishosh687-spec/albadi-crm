"use client";

import { useCallback, useState } from "react";
import type { V2PipelineStage } from "@/lib/manychat/stages";

const STAGE_LABEL: Record<string, string> = {
  INTAKE: "שאלון+הצעה",
  DISCAVERY: "שיחת בירור",
  FACTORY_WAIT: "בדיקת מפעל",
  CONSIDERATION: "שוקל/מו״מ",
  WON: "נסגר",
  LOST: "אבוד",
};

interface NoTaskRow {
  sid: string;
  name: string | null;
  currentStage: V2PipelineStage | null;
  updatedAt: string | null;
}
interface StageLagRow {
  sid: string;
  name: string | null;
  currentStage: V2PipelineStage | null;
  suggestedStage: "INTAKE" | "DISCAVERY" | "FACTORY_WAIT" | "CONSIDERATION";
  reason: string;
}
interface AuditResp {
  ok: boolean;
  noTask?: NoTaskRow[];
  stageLag?: StageLagRow[];
  error?: string;
}

export default function PipelineAuditSection({ token }: { token: string }) {
  const [loading, setLoading] = useState(false);
  const [noTask, setNoTask] = useState<NoTaskRow[] | null>(null);
  const [stageLag, setStageLag] = useState<StageLagRow[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(
        `/api/widget/pipeline-audit?widget_token=${encodeURIComponent(token)}`
      );
      const j: AuditResp = await r.json();
      if (!j.ok) throw new Error(j.error || "failed");
      setNoTask(j.noTask ?? []);
      setStageLag(j.stageLag ?? []);
      setDismissed(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  const applyOne = useCallback(
    async (sid: string, targetStage: string) => {
      setApplying((s) => new Set(s).add(sid));
      try {
        const r = await fetch(
          `/api/widget/pipeline-audit?widget_token=${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sid, targetStage }),
          }
        );
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "apply failed");
        // Drop applied row from the visible list.
        setStageLag((prev) => prev?.filter((r) => r.sid !== sid) ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setApplying((s) => {
          const n = new Set(s);
          n.delete(sid);
          return n;
        });
      }
    },
    [token]
  );

  const applyAll = useCallback(async () => {
    if (!stageLag) return;
    const remaining = stageLag.filter((r) => !dismissed.has(r.sid));
    if (!remaining.length) return;
    if (!confirm(`להעביר ${remaining.length} לידים לשלבים המוצעים?`)) return;
    for (const row of remaining) {
      await applyOne(row.sid, row.suggestedStage);
    }
  }, [stageLag, dismissed, applyOne]);

  const dismiss = (sid: string) =>
    setDismissed((s) => new Set(s).add(sid));

  const visibleLag = stageLag?.filter((r) => !dismissed.has(r.sid)) ?? [];

  return (
    <div style={{ marginTop: 22 }}>
      <div style={header}>
        <div>
          <div className="lux-label" style={{ letterSpacing: "0.16em" }}>
            — Pipeline audit
          </div>
          <div style={{ fontSize: 12.5, color: "#e6e1e0", marginTop: 6 }}>
            בודק שאף ליד לא נפל בין הכיסאות ושהשלבים מסונכרנים עם מה שקרה בפועל.
          </div>
        </div>
        <button onClick={load} disabled={loading} style={btn("accent")}>
          {loading
            ? "בודק…"
            : noTask === null && stageLag === null
            ? "🕳️ בדיקת יישור"
            : "רענן"}
        </button>
      </div>

      {error && (
        <div style={{ color: "#f0b4b4", marginTop: 10, fontSize: 12 }}>
          שגיאה: {error}
        </div>
      )}

      {(noTask !== null || stageLag !== null) && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 14,
            marginTop: 12,
            alignItems: "start",
          }}
        >
          {/* No-task list — informational only, no action. */}
          <div style={card}>
            <div className="lux-label" style={{ marginBottom: 10, letterSpacing: "0.16em" }}>
              נפלו בין הכיסאות
            </div>
            <div style={{ fontSize: 11.5, color: "#8a7f74", marginBottom: 10 }}>
              לידים בשלב פעיל שאין להם שום משימה פתוחה. פתח ב-widget והוסף
              משימה ידנית ב-GHL.
            </div>
            {noTask && noTask.length === 0 ? (
              <div style={{ color: "#8a7f74", fontSize: 12 }}>
                אין לידים נטושים ✓
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {noTask?.slice(0, 100).map((r) => (
                  <div key={r.sid} style={row}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                      {leadLabel(r)}
                    </span>
                    <span style={badgeCurrent}>
                      {r.currentStage
                        ? STAGE_LABEL[r.currentStage] ?? r.currentStage
                        : "בשאלון"}
                    </span>
                  </div>
                ))}
                {noTask && noTask.length > 100 && (
                  <div style={{ color: "#8a7f74", fontSize: 11, marginTop: 6 }}>
                    …ועוד {noTask.length - 100} לידים
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Stage-lag list — action per row + "אשר הכל". */}
          <div style={card}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 10,
              }}
            >
              <div className="lux-label" style={{ letterSpacing: "0.16em" }}>
                שלב לא תואם
              </div>
              {visibleLag.length > 0 && (
                <button onClick={applyAll} style={btn("accent")}>
                  ✓ אשר הכל ({visibleLag.length})
                </button>
              )}
            </div>
            <div style={{ fontSize: 11.5, color: "#8a7f74", marginBottom: 10 }}>
              לידים שהשלב שלהם מיושן לפי מה שקרה בפועל — שיחה שקרתה, בקשה
              למפעל, או PDF שנשלח.
            </div>
            {stageLag && stageLag.length === 0 ? (
              <div style={{ color: "#8a7f74", fontSize: 12 }}>
                כל השלבים מסונכרנים ✓
              </div>
            ) : visibleLag.length === 0 ? (
              <div style={{ color: "#8a7f74", fontSize: 12 }}>
                כל ההצעות טופלו.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {visibleLag.map((r) => (
                  <div key={r.sid} style={{ ...row, alignItems: "flex-start", flexDirection: "column", gap: 6, padding: 10 }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", width: "100%" }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5 }}>
                        {leadLabel(r)}
                      </span>
                      <span style={badgeCurrent}>
                        {r.currentStage
                          ? STAGE_LABEL[r.currentStage] ?? r.currentStage
                          : "בשאלון"}
                      </span>
                      <span style={{ color: "#8a7f74", fontSize: 11 }}>→</span>
                      <span style={badgeSuggested}>
                        {STAGE_LABEL[r.suggestedStage]}
                      </span>
                    </div>
                    <div style={{ fontSize: 11.5, color: "#8a7f74" }}>
                      {r.reason}
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button
                        disabled={applying.has(r.sid)}
                        onClick={() => applyOne(r.sid, r.suggestedStage)}
                        style={btn("accent")}
                      >
                        {applying.has(r.sid) ? "מעביר…" : "✓ אשר"}
                      </button>
                      <button
                        onClick={() => dismiss(r.sid)}
                        style={btn("neutral")}
                      >
                        ✗ דחה
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function leadLabel(l: { name: string | null; sid: string }): string {
  if (l.name && l.name.trim()) return l.name.trim();
  const at = l.sid.indexOf("@");
  return at > 0 ? l.sid.slice(0, at) : l.sid;
}

const card: React.CSSProperties = {
  background: "#1d1b1a",
  borderRadius: 8,
  padding: "18px 20px",
  boxShadow: "inset 0 0 0 1px rgba(69,70,77,0.16)",
};

const header: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  padding: "6px 4px",
};

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 10px",
  background: "rgba(255,255,255,0.02)",
  borderRadius: 6,
  boxShadow: "inset 0 0 0 1px rgba(69,70,77,0.14)",
};

const badgeCurrent: React.CSSProperties = {
  fontSize: 11,
  padding: "2px 8px",
  borderRadius: 6,
  color: "#8a7f74",
  background: "rgba(255,255,255,0.04)",
  boxShadow: "inset 0 0 0 1px rgba(69,70,77,0.20)",
  whiteSpace: "nowrap",
};

const badgeSuggested: React.CSSProperties = {
  fontSize: 11,
  padding: "2px 8px",
  borderRadius: 6,
  color: "#e7cba6",
  background: "rgba(205,169,120,0.14)",
  boxShadow: "inset 0 0 0 1px rgba(205,169,120,0.30)",
  whiteSpace: "nowrap",
};

function btn(tone: "accent" | "neutral"): React.CSSProperties {
  return {
    padding: "7px 13px",
    borderRadius: 8,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 12,
    border: 0,
    boxShadow: `inset 0 0 0 1px ${
      tone === "accent" ? "rgba(205,169,120,0.30)" : "rgba(69,70,77,0.22)"
    }`,
    background: tone === "accent" ? "rgba(205,169,120,0.14)" : "transparent",
    color: tone === "accent" ? "#e7cba6" : "#8a7f74",
  };
}
