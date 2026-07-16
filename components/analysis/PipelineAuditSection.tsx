"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { V2PipelineStage } from "@/lib/manychat/stages";
import { Section, LuxCTA, LuxStat } from "@/components/widget-ui/lux";
import InfoTip, { InfoDot, infoLineStyle } from "./InfoTip";

// Kept in sync with V2_STAGE_LABELS (lib/manychat/stages.ts) so the audit
// speaks the same vocabulary as the rest of the app.
const STAGE_LABEL: Record<string, string> = {
  INTAKE: "קליטה",
  DISCAVERY: "אפיון",
  FACTORY_WAIT: "מחכה למפעל",
  CONSIDERATION: "שוקל / משא ומתן",
  WON: "נסגר",
  LOST: "אבוד",
  FUTURE_FOLLOW_UP: "להתקשר בעתיד",
  NO_RESPONSE_REENGAGE: "לא ענו",
};

const STAGE_HINT: Record<string, string> = {
  INTAKE: "הלקוח נכנס, השאלון הסתיים, נשלחה הצעה משוערת",
  DISCAVERY: "היה קשר של ממש עם איש המכירות (שיחה/התכתבות)",
  FACTORY_WAIT: "נשלחה בקשה למפעל, מחכים למחיר",
  CONSIDERATION: "PDF רשמי ביד הלקוח — שוקל / מתמקח",
};
// NULL and INTAKE both render as "קליטה" — Eli treats them as one stage.
// The internal distinction ("still in questionnaire" vs "questionnaire done +
// auto-quote sent") is invisible in the UI.
const NULL_HINT = STAGE_HINT.INTAKE;
const NULL_LABEL = STAGE_LABEL.INTAKE;

// Order the "נפלו בין הכיסאות" sub-groups by funnel position. NULL folds into
// INTAKE (both render as קליטה — Eli treats them as one stage).
const NOTASK_GROUP_ORDER = [
  "INTAKE",
  "DISCAVERY",
  "FACTORY_WAIT",
  "CONSIDERATION",
] as const;
type NoTaskGroupKey = (typeof NOTASK_GROUP_ORDER)[number];

// A fallen lead's stage → which sub-group it belongs to (NULL → INTAKE).
function groupKeyForStage(s: V2PipelineStage | null): NoTaskGroupKey {
  if (!s || s === "INTAKE") return "INTAKE";
  if (s === "DISCAVERY" || s === "FACTORY_WAIT" || s === "CONSIDERATION") return s;
  return "INTAKE";
}

// "12/07" — short day/month, locale-independent so it renders the same in the
// GHL iframe regardless of the host locale.
function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86_400_000);
}

// Hebrew "how long ago" — "היום" / "אתמול" / "לפני N ימים".
function agoLabel(days: number | null): string | null {
  if (days == null) return null;
  if (days <= 0) return "היום";
  if (days === 1) return "אתמול";
  return `לפני ${days} ימים`;
}

// The suggested-stage the audit can compute — always one of the 6 canonical
// funnel stages. The MANUAL override dropdown offers more (see
// ALL_STAGE_OPTIONS): all 8 GHL columns, incl. the two side stages.
type Target =
  | "INTAKE"
  | "DISCAVERY"
  | "FACTORY_WAIT"
  | "CONSIDERATION"
  | "WON"
  | "LOST";

// Every stage setLeadStage accepts for a MANUAL override = the 8 GHL kanban
// columns Eli manages by hand. Beyond the 6 canonical funnel stages this adds
// the two side stages he'd otherwise have to drag inside GHL:
//   FUTURE_FOLLOW_UP     → להתקשר בעתיד
//   NO_RESPONSE_REENGAGE → לא ענו
type ManualTarget = Target | "FUTURE_FOLLOW_UP" | "NO_RESPONSE_REENGAGE";

interface NoTaskRow {
  sid: string;
  name: string | null;
  currentStage: V2PipelineStage | null;
  createdAt: string | null;
  lastContactAt: string | null;
  updatedAt: string | null;
}
interface StageLagRow {
  sid: string;
  name: string | null;
  currentStage: V2PipelineStage | null;
  suggestedStage: Target;
  reason: string;
  commitmentScore?: number | null;
  hasAnalysis?: boolean;
}
interface AuditResp {
  ok: boolean;
  noTask?: NoTaskRow[];
  stageLag?: StageLagRow[];
  error?: string;
}

const TARGET_ORDER: Target[] = ["CONSIDERATION", "FACTORY_WAIT", "DISCAVERY", "INTAKE"];

export default function PipelineAuditSection({ token }: { token: string }) {
  const [loading, setLoading] = useState(false);
  const [noTask, setNoTask] = useState<NoTaskRow[] | null>(null);
  const [stageLag, setStageLag] = useState<StageLagRow[] | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // Which groups + rows are expanded.
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    new Set(["noTask", "CONSIDERATION"])
  );
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());

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
      setOpenRows(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Auto-run on mount so Eli sees the state without clicking "בדיקת יישור".
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Create a "call the customer" task (Itay, due today) for a lead that fell
  // through the cracks, and push it to GHL. On success drop the row — it now has
  // an open task so it's no longer "between the chairs".
  const createTask = useCallback(
    async (sid: string) => {
      setApplying((s) => new Set(s).add(sid));
      try {
        const r = await fetch(
          `/api/widget/pipeline-audit?widget_token=${encodeURIComponent(token)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sid, action: "create_task" }),
          }
        );
        const j = await r.json();
        if (!j.ok) throw new Error(j.error || "task failed");
        setNoTask((prev) => prev?.filter((x) => x.sid !== sid) ?? null);
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

  const applyGroup = useCallback(
    async (target: Target) => {
      const list = (stageLag ?? []).filter(
        (r) => r.suggestedStage === target && !dismissed.has(r.sid)
      );
      if (!list.length) return;
      if (
        !confirm(
          `להעביר ${list.length} לידים ל"${STAGE_LABEL[target]}"?`
        )
      )
        return;
      for (const row of list) {
        await applyOne(row.sid, row.suggestedStage);
      }
    },
    [stageLag, dismissed, applyOne]
  );

  const dismiss = (sid: string) => setDismissed((s) => new Set(s).add(sid));

  const toggleGroup = (k: string) =>
    setOpenGroups((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  const toggleRow = (sid: string) =>
    setOpenRows((s) => {
      const n = new Set(s);
      if (n.has(sid)) n.delete(sid);
      else n.add(sid);
      return n;
    });

  const visibleLag = useMemo(
    () => stageLag?.filter((r) => !dismissed.has(r.sid)) ?? [],
    [stageLag, dismissed]
  );

  const byTarget = useMemo(() => {
    const m = new Map<Target, StageLagRow[]>();
    for (const t of TARGET_ORDER) m.set(t, []);
    for (const r of visibleLag) {
      const list = m.get(r.suggestedStage);
      if (list) list.push(r);
    }
    return m;
  }, [visibleLag]);

  // Split fallen leads into per-stage sub-groups, each sorted oldest-contact
  // first (the stalest lead in a stage floats to the top — that's the one most
  // likely truly forgotten).
  const noTaskByGroup = useMemo(() => {
    const m = new Map<NoTaskGroupKey, NoTaskRow[]>();
    for (const k of NOTASK_GROUP_ORDER) m.set(k, []);
    for (const r of noTask ?? []) {
      m.get(groupKeyForStage(r.currentStage))!.push(r);
    }
    for (const list of m.values()) {
      list.sort((a, b) => {
        const ta = a.lastContactAt ? Date.parse(a.lastContactAt) : 0;
        const tb = b.lastContactAt ? Date.parse(b.lastContactAt) : 0;
        return ta - tb; // oldest contact first
      });
    }
    return m;
  }, [noTask]);

  const avgCommitment = useMemo(() => {
    const withScore = visibleLag.filter((r) => r.commitmentScore != null);
    if (!withScore.length) return null;
    const sum = withScore.reduce((s, r) => s + (r.commitmentScore ?? 0), 0);
    return (sum / withScore.length).toFixed(1);
  }, [visibleLag]);

  const notLoaded = noTask === null && stageLag === null;

  return (
    <Section
      eyebrow="— Pipeline audit"
      title={
        <InfoTip
          info={
            <>
              שני מנגנוני בקרה שרצים אוטומטית: <b>"נפלו בין הכיסאות"</b> — לידים
              פעילים שאין להם משימה פתוחה (בסכנת שכחה), ו<b>"שלב לא תואם"</b> —
              לידים שהשלב שלהם ב-GHL מפגר אחרי מה שהניתוח מצא בשיחות. הבוט לא מזיז
              שלבים לבד — אתה מאשר.
            </>
          }
        >
          <span>
            יישור <span className="lux-accent">הלידים</span>.
          </span>
        </InfoTip>
      }
      style={{ marginTop: 22 }}
    >
      {/* KPI + refresh */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 14,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <div style={{ fontSize: 12.5, color: "var(--lux-muted)", maxWidth: 420 }}>
          בודקים שאף ליד לא נשכח, ושהשלבים בפייפליין מסונכרנים עם מה שהניתוח
          מוצא בשיחות ובהתכתבויות של הליד.
        </div>
        <LuxCTA variant="champagne" onClick={load} disabled={loading}>
          {loading ? "בודק…" : notLoaded ? "🕳️ בדיקת יישור" : "רענן"}
        </LuxCTA>
      </div>

      {!notLoaded && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
            gap: 8,
            marginBottom: 16,
          }}
        >
          <LuxStat
            value={noTask?.length ?? 0}
            label="בלי משימה"
            tone={noTask?.length ? "alert" : "default"}
          />
          <LuxStat
            value={visibleLag.length}
            label="שלב לא תואם"
            tone={visibleLag.length ? "champagne" : "default"}
          />
          <LuxStat
            value={avgCommitment ?? "—"}
            label="מחויבות ממוצעת"
            tone={
              avgCommitment && parseFloat(avgCommitment) >= 3
                ? "success"
                : "default"
            }
          />
          <LuxStat value={dismissed.size} label="נדחו" />
        </div>
      )}

      {error && (
        <div
          style={{
            color: "#e8b4b4",
            fontSize: 12,
            marginBottom: 10,
            padding: "8px 12px",
            background: "rgba(232,180,180,0.08)",
            borderRadius: 6,
          }}
        >
          שגיאה: {error}
        </div>
      )}

      {notLoaded ? (
        <div
          style={{
            padding: "40px 20px",
            textAlign: "center",
            color: "var(--lux-muted)",
            fontSize: 13,
          }}
        >
          לחץ "בדיקת יישור" למעלה כדי לנתח את המצב.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Group 1 — no-task list, split into per-stage sub-groups */}
          <GroupCard
            open={openGroups.has("noTask")}
            onToggle={() => toggleGroup("noTask")}
            title="נפלו בין הכיסאות"
            count={noTask?.length ?? 0}
            tone="alert"
            subtitle="לידים בשלב פעיל שאין להם שום משימה פתוחה — פתח בווידג'ט והוסף משימה ב-GHL."
            info={
              <>
                כאן כל ליד שנמצא בשלב פעיל (קליטה / אפיון / מחכה למפעל / שוקל)
                אבל <b>אין לו שום משימה פתוחה</b> — כלומר כלום לא מתוזמן לקרות
                איתו, והוא עלול להישכח. מפוצל לפי שלב, ובכל ליד רואים <b>מתי
                נכנס</b> ו<b>מתי היה קשר אחרון</b> כדי לדעת כמה הוא תקוע. לידים
                שסגורים (נסגר / אבוד) או ב"להתקשר בעתיד" / "לא ענו" לא נספרים כאן.
              </>
            }
            action={null}
          >
            {noTask && noTask.length === 0 ? (
              <EmptyRow text="אין לידים נטושים ✓" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {NOTASK_GROUP_ORDER.map((gk) => {
                  const rows = noTaskByGroup.get(gk) ?? [];
                  if (!rows.length) return null;
                  return (
                    <div key={gk}>
                      <div style={subGroupHeader}>
                        <span style={subGroupTitle}>{STAGE_LABEL[gk]}</span>
                        <span style={subGroupCount}>{rows.length}</span>
                      </div>
                      <div
                        style={{ display: "flex", flexDirection: "column", gap: 6 }}
                      >
                        {rows.map((r) => (
                          <NoTaskLead
                            key={r.sid}
                            row={r}
                            busy={applying.has(r.sid)}
                            onCreateTask={createTask}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </GroupCard>

          {/* Groups 2..N — one per target stage */}
          {TARGET_ORDER.map((target) => {
            const rows = byTarget.get(target) ?? [];
            if (!rows.length) return null;
            return (
              <GroupCard
                key={target}
                open={openGroups.has(target)}
                onToggle={() => toggleGroup(target)}
                // "להעביר ל…" not just the stage name — these are leads SUGGESTED
                // to move TO this stage (currently at an earlier stage), not
                // leads already in it. The bare stage label read as "current
                // leads in אפיון" and confused Eli (2026-07-16).
                title={`להעביר ל${STAGE_LABEL[target]}`}
                count={rows.length}
                tone="champagne"
                subtitle={STAGE_HINT[target]}
                info={
                  <>
                    לידים שהניתוח (שיחות + התכתבויות) מצא שהם כבר בפועל בשלב
                    <b> "{STAGE_LABEL[target]}"</b>, אבל השלב שלהם ב-GHL עדיין
                    מאחור. לחץ <b>אשר</b> כדי להעביר את הליד לשלב הזה, <b>דחה</b>
                    כדי להתעלם, או בחר שלב אחר ידנית ב"או ל־".
                  </>
                }
                action={
                  <LuxCTA
                    variant="champagne"
                    onClick={(e) => {
                      e.stopPropagation();
                      applyGroup(target);
                    }}
                    style={{ fontSize: 11.5, padding: "7px 14px" }}
                  >
                    ✓ אשר את כל {rows.length} הלידים
                  </LuxCTA>
                }
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {rows.map((r) => (
                    <LagRow
                      key={r.sid}
                      row={r}
                      open={openRows.has(r.sid)}
                      onToggle={() => toggleRow(r.sid)}
                      onApprove={() => applyOne(r.sid, r.suggestedStage)}
                      onApplyManual={(t) => applyOne(r.sid, t)}
                      onDismiss={() => dismiss(r.sid)}
                      applying={applying.has(r.sid)}
                    />
                  ))}
                </div>
              </GroupCard>
            );
          })}

          {visibleLag.length === 0 && (
            <EmptyRow text="כל השלבים מסונכרנים ✓" />
          )}
        </div>
      )}
    </Section>
  );
}

// ── sub-components ─────────────────────────────────────────────────────────

function GroupCard({
  open,
  onToggle,
  title,
  count,
  tone,
  subtitle,
  info,
  action,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  title: string;
  count: number;
  tone: "alert" | "champagne";
  subtitle?: string;
  info?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [infoOpen, setInfoOpen] = useState(false);
  const chip =
    tone === "alert"
      ? {
          color: "#e8b4b4",
          bg: "rgba(232,180,180,0.12)",
          edge: "rgba(232,180,180,0.30)",
        }
      : {
          color: "var(--lux-champagne)",
          bg: "rgba(214,196,172,0.12)",
          edge: "rgba(214,196,172,0.30)",
        };
  return (
    <div
      style={{
        background: "var(--lux-card)",
        borderRadius: 8,
        boxShadow: "inset 0 0 0 1px var(--lux-line)",
        overflow: "hidden",
      }}
    >
      {/* Header — always compact: chevron + title + count. No action inline. */}
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 16px",
          cursor: "pointer",
          userSelect: "none",
          minWidth: 0,
        }}
      >
        <span style={{ color: "var(--lux-muted)", fontSize: 13, width: 14, flexShrink: 0 }}>
          {open ? "▾" : "▸"}
        </span>
        <span
          className="lux-serif"
          style={{
            fontSize: 15,
            color: "var(--lux-ink)",
            flex: "1 1 auto",
            minWidth: 0,
            wordBreak: "keep-all",
            lineHeight: 1.3,
          }}
        >
          {title}
        </span>
        <span
          style={{
            fontSize: 11,
            padding: "2px 8px",
            borderRadius: 99,
            color: chip.color,
            background: chip.bg,
            boxShadow: `inset 0 0 0 1px ${chip.edge}`,
            fontVariantNumeric: "tabular-nums",
            flexShrink: 0,
          }}
        >
          {count}
        </span>
        {info && (
          <InfoDot open={infoOpen} onToggle={() => setInfoOpen((o) => !o)} />
        )}
      </div>

      {info && infoOpen && (
        <div style={{ ...infoLineStyle, margin: "0 16px 12px", marginTop: -4 }}>
          {info}
        </div>
      )}

      {subtitle && (
        <div
          style={{
            padding: "0 16px 12px",
            fontSize: 11.5,
            color: "var(--lux-muted)",
            marginTop: -8,
            paddingInlineStart: 40,
            lineHeight: 1.45,
          }}
        >
          {subtitle}
        </div>
      )}

      {open && (
        <div style={{ padding: "0 12px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
          {children}
          {action && (
            <div style={{ paddingTop: 4, display: "flex", justifyContent: "flex-end" }}>
              {action}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Every stage the API accepts for a manual override — all 8 GHL columns,
// including terminal WON/LOST and the two side stages.
const ALL_STAGE_OPTIONS: ManualTarget[] = [
  "INTAKE",
  "DISCAVERY",
  "FACTORY_WAIT",
  "CONSIDERATION",
  "WON",
  "LOST",
  "FUTURE_FOLLOW_UP",
  "NO_RESPONSE_REENGAGE",
];

function LagRow({
  row,
  open,
  onToggle,
  onApprove,
  onApplyManual,
  onDismiss,
  applying,
}: {
  row: StageLagRow;
  open: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onApplyManual: (target: ManualTarget) => void;
  onDismiss: () => void;
  applying: boolean;
}) {
  const [manualTarget, setManualTarget] = useState<ManualTarget>(row.suggestedStage);
  return (
    <div
      style={{
        background: "rgba(255,255,255,0.02)",
        boxShadow: "inset 0 0 0 1px rgba(69,70,77,0.14)",
        borderRadius: 6,
        width: "100%",
        boxSizing: "border-box",
      }}
    >
      {/* Summary row — name, both stages, per-row actions, always visible */}
      <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8, width: "100%", boxSizing: "border-box" }}>
        {/* Line 1 — chevron + name + commitment */}
        <div
          onClick={onToggle}
          role="button"
          tabIndex={0}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            minWidth: 0,
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          <span
            style={{
              color: "var(--lux-muted)",
              fontSize: 11,
              width: 10,
              flexShrink: 0,
            }}
          >
            {open ? "▾" : "▸"}
          </span>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 13,
              color: "var(--lux-ink)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {leadLabel(row)}
          </span>
          {row.hasAnalysis && row.commitmentScore != null && (
            <span
              style={commitmentBadge(row.commitmentScore)}
              title="ציון מחויבות מתוך הניתוח"
            >
              {row.commitmentScore}/5
            </span>
          )}
        </div>

        {/* Line 2 — current → suggested, always visible */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            flexWrap: "wrap",
            paddingInlineStart: 18,
          }}
        >
          <span style={arrowLabel}>מ־</span>
          <span style={badgeCurrentSmall}>
            {row.currentStage
              ? STAGE_LABEL[row.currentStage] ?? row.currentStage
              : NULL_LABEL}
          </span>
          <span style={{ color: "var(--lux-muted)", fontSize: 12 }}>←</span>
          <span style={arrowLabel}>ל־</span>
          <span style={badgeSuggestedSmall}>
            {STAGE_LABEL[row.suggestedStage]}
          </span>
        </div>

        {/* Line 3 — approve/dismiss + manual override, always visible */}
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            paddingInlineStart: 18,
            alignItems: "center",
          }}
        >
          <button
            disabled={applying}
            onClick={onApprove}
            style={{
              ...smallBtn("champagne"),
              opacity: applying ? 0.6 : 1,
            }}
          >
            {applying ? "מעביר…" : "✓ אשר"}
          </button>
          <button onClick={onDismiss} style={smallBtn("ghost")}>
            ✗ דחה
          </button>
        </div>

        {/* Line 4 — manual override on every row (no need to expand) */}
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            paddingInlineStart: 18,
            alignItems: "center",
          }}
        >
          <span style={arrowLabel}>או ל־</span>
          <select
            value={manualTarget}
            onChange={(e) => setManualTarget(e.target.value as ManualTarget)}
            onClick={(e) => e.stopPropagation()}
            style={selectStyle}
          >
            {ALL_STAGE_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
          <button
            disabled={applying}
            onClick={() => onApplyManual(manualTarget)}
            style={smallBtn("ghost")}
          >
            → העבר
          </button>
          <button
            onClick={onToggle}
            style={{ ...smallBtn("ghost"), opacity: 0.6 }}
          >
            {open ? "סגור" : "פרטים"}
          </button>
        </div>
      </div>

      {/* Details when open — hints per stage + full reason */}
      {open && (
        <div
          style={{
            padding: "0 12px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div style={arrowRow}>
            <div style={stageBlock}>
              <div className="lux-label" style={arrowLabel}>מ־</div>
              <div style={badgeCurrent}>
                {row.currentStage
                  ? STAGE_LABEL[row.currentStage] ?? row.currentStage
                  : NULL_LABEL}
              </div>
              <div style={hint}>
                {row.currentStage
                  ? STAGE_HINT[row.currentStage] ?? ""
                  : NULL_HINT}
              </div>
            </div>
            <div style={arrowDivider}>▼</div>
            <div style={stageBlock}>
              <div className="lux-label" style={arrowLabel}>ל־</div>
              <div style={badgeSuggested}>
                {STAGE_LABEL[row.suggestedStage]}
              </div>
              <div style={hint}>{STAGE_HINT[row.suggestedStage] ?? ""}</div>
            </div>
          </div>

          <div style={{ fontSize: 12, color: "var(--lux-muted)", lineHeight: 1.5 }}>
            <div
              className="lux-label"
              style={{
                fontSize: 9.5,
                marginBottom: 4,
                letterSpacing: "0.14em",
              }}
            >
              — למה
            </div>
            {row.reason}
          </div>

        </div>
      )}
    </div>
  );
}

// One fallen lead — name + when it entered + when last contacted, coloured by
// how stale the last contact is so the truly-forgotten ones jump out.
function NoTaskLead({
  row,
  busy,
  onCreateTask,
}: {
  row: NoTaskRow;
  busy: boolean;
  onCreateTask: (sid: string) => void;
}) {
  const created = fmtDate(row.createdAt);
  const contact = fmtDate(row.lastContactAt);
  const staleDays = daysSince(row.lastContactAt);
  const tone =
    row.lastContactAt == null
      ? { c: "#e8b4b4" } // never messaged → treat as most urgent
      : (staleDays ?? 0) >= 7
      ? { c: "#e8b4b4" }
      : (staleDays ?? 0) >= 3
      ? { c: "#e0a96d" }
      : { c: "var(--lux-muted)" };
  return (
    <div
      style={{
        ...noTaskRow,
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 6,
      }}
    >
      <span
        style={{
          fontSize: 13,
          color: "var(--lux-ink)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: "100%",
        }}
      >
        {leadLabel(row)}
      </span>
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          fontSize: 11,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <span style={{ color: "var(--lux-muted)" }}>
          נכנס {created ?? "—"}
        </span>
        <span style={{ color: tone.c }}>
          קשר אחרון{" "}
          {contact
            ? `${contact} · ${agoLabel(staleDays)}`
            : "— אין הודעות"}
        </span>
      </div>
      <button
        type="button"
        onClick={() => onCreateTask(row.sid)}
        disabled={busy}
        title='יוצר משימה לאיש המכירות ב-GHL — "לדבר עם הלקוח", להיום'
        style={{
          marginTop: 2,
          fontSize: 11,
          fontWeight: 600,
          padding: "6px 12px",
          borderRadius: 6,
          border: "1px solid rgba(214,196,172,0.35)",
          background: "rgba(214,196,172,0.10)",
          color: "#d6c4ac",
          cursor: busy ? "default" : "pointer",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "יוצר…" : "+ צור משימה למכירות"}
      </button>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: "20px 12px",
        textAlign: "center",
        color: "var(--lux-muted)",
        fontSize: 12.5,
      }}
    >
      {text}
    </div>
  );
}

function leadLabel(l: { name: string | null; sid: string }): string {
  if (l.name && l.name.trim()) return l.name.trim();
  const at = l.sid.indexOf("@");
  return at > 0 ? l.sid.slice(0, at) : l.sid;
}

// ── styles ─────────────────────────────────────────────────────────────────

const noTaskRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "9px 12px",
  background: "rgba(255,255,255,0.02)",
  borderRadius: 6,
  boxShadow: "inset 0 0 0 1px rgba(69,70,77,0.14)",
};

const subGroupHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 6,
  paddingInlineStart: 2,
};

const subGroupTitle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: "0.08em",
  color: "var(--lux-champagne)",
};

const subGroupCount: React.CSSProperties = {
  fontSize: 10.5,
  padding: "1px 7px",
  borderRadius: 99,
  color: "var(--lux-muted)",
  background: "rgba(255,255,255,0.04)",
  boxShadow: "inset 0 0 0 1px rgba(69,70,77,0.20)",
  fontVariantNumeric: "tabular-nums",
};

const badgeCurrent: React.CSSProperties = {
  fontSize: 12,
  padding: "5px 12px",
  borderRadius: 6,
  color: "var(--lux-muted)",
  background: "rgba(255,255,255,0.04)",
  boxShadow: "inset 0 0 0 1px rgba(69,70,77,0.22)",
  whiteSpace: "nowrap",
};

const badgeCurrentSmall: React.CSSProperties = {
  ...badgeCurrent,
  fontSize: 11,
  padding: "3px 9px",
  whiteSpace: "normal",
  wordBreak: "keep-all",
  maxWidth: "100%",
  display: "inline-block",
};

const badgeSuggested: React.CSSProperties = {
  fontSize: 12,
  padding: "5px 12px",
  borderRadius: 6,
  color: "var(--lux-champagne)",
  background: "rgba(214,196,172,0.18)",
  boxShadow: "inset 0 0 0 1px rgba(214,196,172,0.40)",
  whiteSpace: "nowrap",
  fontWeight: 500,
};

const badgeSuggestedSmall: React.CSSProperties = {
  ...badgeSuggested,
  fontSize: 11,
  padding: "3px 9px",
  whiteSpace: "normal",
  wordBreak: "keep-all",
  maxWidth: "100%",
  display: "inline-block",
};

const arrowRow: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  padding: "12px",
  background: "rgba(0,0,0,0.15)",
  borderRadius: 6,
  boxShadow: "inset 0 0 0 1px rgba(69,70,77,0.12)",
};

const stageBlock: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 5,
  alignItems: "flex-start",
};

const arrowLabel: React.CSSProperties = {
  fontSize: 9.5,
  color: "var(--lux-muted)",
  letterSpacing: "0.14em",
};

const arrowDivider: React.CSSProperties = {
  fontSize: 10,
  color: "var(--lux-muted)",
  letterSpacing: "0.14em",
  textAlign: "center",
  padding: "2px 0",
};

const hint: React.CSSProperties = {
  fontSize: 11,
  color: "#a8a29a",
  lineHeight: 1.45,
  marginTop: 2,
};

const selectStyle: React.CSSProperties = {
  background: "#211f1e",
  color: "var(--lux-ink)",
  border: 0,
  boxShadow: "inset 0 0 0 1px rgba(69,70,77,0.30)",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 12,
  fontFamily: "inherit",
  cursor: "pointer",
  flex: 1,
  minWidth: 0,
};

function smallBtn(tone: "champagne" | "ghost"): React.CSSProperties {
  return {
    fontSize: 12,
    padding: "7px 14px",
    borderRadius: 6,
    cursor: "pointer",
    fontFamily: "inherit",
    border: 0,
    boxShadow: `inset 0 0 0 1px ${
      tone === "champagne" ? "rgba(214,196,172,0.40)" : "rgba(69,70,77,0.22)"
    }`,
    background: tone === "champagne" ? "rgba(214,196,172,0.18)" : "transparent",
    color: tone === "champagne" ? "var(--lux-champagne)" : "var(--lux-muted)",
    fontWeight: tone === "champagne" ? 500 : 400,
  };
}

function commitmentBadge(score: number): React.CSSProperties {
  const tone =
    score >= 4
      ? { color: "#a8c0a0", bg: "rgba(168,192,160,0.14)", edge: "rgba(168,192,160,0.30)" }
      : score >= 2
      ? { color: "#e0a96d", bg: "rgba(224,169,109,0.14)", edge: "rgba(224,169,109,0.30)" }
      : { color: "var(--lux-muted)", bg: "rgba(255,255,255,0.04)", edge: "rgba(69,70,77,0.20)" };
  return {
    fontSize: 10.5,
    padding: "2px 8px",
    borderRadius: 99,
    color: tone.color,
    background: tone.bg,
    boxShadow: `inset 0 0 0 1px ${tone.edge}`,
    whiteSpace: "nowrap",
    fontFamily: "var(--font-body), Heebo, system-ui",
    fontVariantNumeric: "tabular-nums",
  };
}
