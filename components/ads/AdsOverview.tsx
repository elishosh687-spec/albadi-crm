"use client";

/**
 * "מודעות" — the main view of the ads tab (ui-ux-pro-max redesign):
 * 1. לטיפול עכשיו — what needs a human, from real checks only;
 * 2. four KPIs, each with its meaning in words ("1 מכל 45 לידים");
 * 3. one collapsed row per ad (lead-quality report joined with the Meta
 *    recommendation of the same name); details + decision on tap.
 *
 * Recommendation only — nothing here writes to Meta. The one write is Eli's
 * approved status (ReviewEditor), an internal CRM decision.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronDown, Target } from "lucide-react";
import type { AdPerformanceReport } from "@/lib/analysis/ad-performance";
import type { RecommendationsReport } from "@/lib/ads/assemble";
import { APPROVED_STATUS_LABELS } from "@/lib/ads/review-state";
import {
  buildRecommendationTodo,
  mergeOverviewRows,
  oneIn,
  sortOverviewRows,
  type OverviewRow,
  type OverviewSort,
  type TodoItem,
} from "@/lib/ads/overview";
import { CODE_TONE, ReviewEditor, ROLE_LABELS, SEGMENT_LABELS } from "./ReviewEditor";

const ils = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `₪${Math.round(n).toLocaleString("he-IL")}`;
const ils2 = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `₪${(Math.round(n * 100) / 100).toLocaleString("he-IL")}`;

const SORTS: { id: OverviewSort; label: string }[] = [
  { id: "revenue", label: "הכנסה" },
  { id: "won", label: "עסקאות" },
  { id: "good", label: "לידים טובים" },
  { id: "leads", label: "לידים" },
];

export function AdsOverview({
  apiToken,
  report,
  serverTodo,
  metaHref,
}: {
  apiToken: string;
  report: AdPerformanceReport;
  serverTodo: TodoItem[];
  /** Link to the "דיווח למטא" sub-view. */
  metaHref: string;
}) {
  const router = useRouter();
  const [recs, setRecs] = useState<RecommendationsReport | null>(null);
  const [recError, setRecError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<OverviewSort>("revenue");
  const [showRest, setShowRest] = useState(false);
  const [showAllTodo, setShowAllTodo] = useState(false);
  const [live, setLive] = useState("");

  const load = useCallback(
    async (fresh = false) => {
      setLoading(true);
      setRecError(null);
      try {
        const r = await fetch(`/api/widget/ads/recommendations?widget_token=${encodeURIComponent(apiToken)}${fresh ? "&fresh=1" : ""}`);
        const body = await r.json();
        if (!r.ok || !body.ok) throw new Error(body.error ?? "טעינת ההמלצות נכשלה");
        setRecs(body);
        if (fresh) setLive("הנתונים עודכנו");
      } catch (e) {
        setRecError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [apiToken],
  );
  useEffect(() => {
    load();
  }, [load]);

  const refresh = () => {
    setLive("מרענן…");
    router.refresh();
    load(true);
  };

  const rows = useMemo(() => sortOverviewRows(mergeOverviewRows(report.rows, recs?.rows ?? null), sort), [report.rows, recs, sort]);
  const leading = rows.filter((r) => r.leading);
  const rest = rows.filter((r) => !r.leading);
  const restLeads = rest.reduce((a, r) => a + r.leads, 0);

  const todo: TodoItem[] = [
    ...serverTodo,
    ...(recError
      ? [{ key: "rec-error", title: "ההמלצות לא נטענו", detail: `${recError}. המספרים מה-CRM בטבלה נכונים; לחץ ״רענן״ לנסות שוב.`, target: "ads" as const }]
      : []),
    ...(recs ? buildRecommendationTodo(recs.rows, recs.structure.warnings, recs.health.meta.ok, recs.health.meta.reason) : []),
  ];
  const TODO_CAP = 4;
  const shownTodo = showAllTodo ? todo : todo.slice(0, TODO_CAP);

  const t = report.totals;
  const topRevenue = Math.max(1, ...rows.map((r) => r.revenueIls));

  return (
    <div>
      {todo.length === 0 ? (
        <section className="ux-todo ok" aria-label="לטיפול עכשיו">
          <h2>
            <CheckCircle2 className="size-4" aria-hidden /> אין כרגע משהו שדורש טיפול — החיבורים תקינים וכל העסקאות דווחו.
          </h2>
        </section>
      ) : (
        <section className="ux-todo" aria-label="לטיפול עכשיו">
          <h2>
            <Target className="size-4" aria-hidden /> לטיפול עכשיו
          </h2>
          <ol>
            {shownTodo.map((item, i) => (
              <li key={item.key}>
                <span className="n" aria-hidden>{i + 1}</span>
                <div className="t">
                  <b>{item.title}</b>
                  <span>{item.detail}</span>
                </div>
                {item.target === "meta" ? (
                  <a className="ux-btn" href={metaHref}>פרטים</a>
                ) : null}
              </li>
            ))}
          </ol>
          {todo.length > TODO_CAP && (
            <button type="button" className="ux-btn" style={{ marginTop: 12 }} aria-expanded={showAllTodo} onClick={() => setShowAllTodo((v) => !v)}>
              {showAllTodo ? "הצג פחות" : `עוד ${todo.length - TODO_CAP}`}
            </button>
          )}
        </section>
      )}

      <div className="ux-kpis">
        <Kpi k="לידים" v={t.leads.toLocaleString("he-IL")} e={<>מכל המודעות בתקופה</>} />
        <Kpi k="לידים טובים" v={t.markedGood.toLocaleString("he-IL")} e={oneIn(t.markedGood, t.leads) ? <><b>{oneIn(t.markedGood, t.leads)}</b> לידים</> : "עוד לא סומן אף ליד טוב"} />
        <Kpi k="עסקאות שנסגרו" v={t.won.toLocaleString("he-IL")} e={oneIn(t.won, t.leads) ? <><b>{oneIn(t.won, t.leads)}</b> לידים</> : "עוד לא נסגרה עסקה"} />
        <Kpi
          k="הכנסה ממודעות"
          v={ils(t.revenueIls)}
          e={
            report.totalSpendIls !== null ? (
              <>הוצאה <b>{ils(report.totalSpendIls)}</b> · נשאר <b>{ils(t.revenueIls - report.totalSpendIls)}</b></>
            ) : t.leads > 0 ? (
              <><b>{ils(t.revenueIls / t.leads)}</b> לכל ליד</>
            ) : (
              "—"
            )
          }
        />
      </div>

      <div className="ux-sechead">
        <h2>מודעות שהביאו תוצאה</h2>
        <div className="ux-chips">
          <label className="ux-select">
            מיון
            <select value={sort} onChange={(e) => setSort(e.target.value as OverviewSort)}>
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <button type="button" className="ux-btn" onClick={refresh} disabled={loading} aria-busy={loading} aria-label="רענן נתונים ממטא">
            {loading ? "טוען…" : "רענן"}
          </button>
        </div>
      </div>
      <p className="ux-sr" aria-live="polite">{live}</p>

      {rows.length === 0 ? (
        <div className="ux-panel" style={{ textAlign: "center", color: "var(--lux-muted)" }}>
          אין עדיין לידים ממודעות בתקופה הזו. נסה ״הכל״ בבחירת התקופה למעלה.
        </div>
      ) : (
        <div className="ux-list" aria-busy={loading}>
          <div className="ux-colhead" aria-hidden>
            <span>מודעה</span><span>לידים</span><span>טובים</span><span>עסקאות</span><span>הכנסה</span><span>המלצה</span><span />
          </div>
          {leading.length === 0 && (
            <div style={{ padding: "16px 18px", color: "var(--lux-muted)", fontSize: 14 }}>
              אף מודעה עוד לא הביאה עסקה או ליד טוב בתקופה הזו.
            </div>
          )}
          {leading.map((r) => (
            <AdRow key={r.key} row={r} topRevenue={topRevenue} loadingRec={loading && !recs} apiToken={apiToken} onSaved={() => load(false)} />
          ))}
          {rest.length > 0 && (
            <>
              <button type="button" className="ux-more" aria-expanded={showRest} onClick={() => setShowRest((v) => !v)}>
                <span>{showRest ? "הסתר מודעות בלי תוצאה" : `עוד ${rest.length} מודעות בלי תוצאה · ${restLeads} לידים`}</span>
                <ChevronDown className="size-4" style={{ transform: showRest ? "rotate(180deg)" : undefined }} aria-hidden />
              </button>
              {showRest && rest.map((r) => (
                <AdRow key={r.key} row={r} topRevenue={topRevenue} loadingRec={loading && !recs} apiToken={apiToken} onSaved={() => load(false)} />
              ))}
            </>
          )}
        </div>
      )}

      {report.unattributed > 0 && (
        <p className="ux-note">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {report.unattributed} לידים מפייסבוק בלי שיוך למודעה (לא נמצאה התאמה בגיליון הטופס) — לא נספרים בטבלה.
        </p>
      )}
    </div>
  );
}

function Kpi({ k, v, e }: { k: string; v: string; e: React.ReactNode }) {
  return (
    <div className="ux-kpi">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      <div className="e">{e}</div>
    </div>
  );
}

function AdRow({
  row,
  topRevenue,
  loadingRec,
  apiToken,
  onSaved,
}: {
  row: OverviewRow;
  topRevenue: number;
  loadingRec: boolean;
  apiToken: string;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const rec = row.rec;
  const m = rec?.recommendation.metrics;
  // Without Meta's spend history, spend is UNKNOWN, not ₪0 — every figure
  // derived from it would be a confident lie.
  const noSpend = !rec || !rec.evidence.dailyHistoryComplete;
  const dash = (n: number) => (n > 0 ? n.toLocaleString("he-IL") : "—");

  return (
    <details className="ux-row">
      <summary>
        <div>
          <div className="name"><span className="ltr">{row.adName}</span></div>
          {row.campaignName && <div className="sub"><span className="ltr">{row.campaignName}</span></div>}
          {row.revenueIls > 0 && (
            <div className="ux-bar" aria-hidden><i style={{ width: `${Math.max(3, (row.revenueIls / topRevenue) * 100)}%` }} /></div>
          )}
        </div>
        <div className="m">{row.leads.toLocaleString("he-IL")}</div>
        <div className={`m${row.markedGood ? "" : " none"}`}>{dash(row.markedGood)}</div>
        <div className={`m${row.won ? "" : " none"}`}>{dash(row.won)}</div>
        <div className={`m${row.revenueIls ? " money" : " none"}`}>{row.revenueIls ? ils(row.revenueIls) : "—"}</div>
        {rec ? (
          <span className="ux-pill" data-tone={CODE_TONE[rec.recommendation.code]}>
            {rec.conflict && <AlertTriangle className="size-3.5" aria-label="סותר את ההחלטה שלך" />}
            {rec.recommendation.label}
          </span>
        ) : loadingRec ? (
          <span className="ux-pill" data-tone="idle">טוען…</span>
        ) : (
          <span className="ux-pill" data-tone="idle">אין המלצה</span>
        )}
        <ChevronDown className="chev size-4" aria-hidden />
        <div className="mline">
          <span><b>{row.leads}</b> לידים</span>
          <span><b>{row.markedGood}</b> טובים</span>
          <span><b>{row.won}</b> עסקאות</span>
          {row.revenueIls > 0 && <span className="g">{ils(row.revenueIls)}</span>}
        </div>
      </summary>

      <div className="ux-detail">
        <div className="ux-box">
          <h3>למה ההמלצה הזו</h3>
          {rec ? (
            <>
              <ul>
                {rec.recommendation.reasons.map((x, i) => <li key={i}>{x.text}</li>)}
              </ul>
              <div className="ux-metrics">
                <Metric k="עלות לליד (CPL)" v={noSpend ? "—" : ils2(m?.cplIls)} />
                <Metric k="עלות ללקוח (CAC)" v={noSpend ? "—" : ils(m?.cacIls)} />
                <Metric k="רווח אחרי פרסום" v={noSpend ? "—" : ils(m?.contributionAfterAdsIls)} />
                <Metric k="הוצאה" v={noSpend ? "לא ידוע" : ils(m?.spendIls)} />
                <Metric k="לידים מתאימים" v={rec.suitableLeads === null ? "—" : String(rec.suitableLeads)} />
                <Metric k="ימי הצגה" v={noSpend ? "—" : String(m?.deliveryDays ?? "—")} />
              </div>
              {rec.warnings.map((w) => <p key={w} className="ux-note" style={{ color: "#ecdcb3" }}><AlertTriangle className="size-4 shrink-0" aria-hidden />{w}</p>)}
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-[14px]" style={{ borderColor: "var(--lux-line-soft)" }}>
                <span className="text-muted-foreground">ההחלטה שלך:</span>
                <strong className="font-medium">{APPROVED_STATUS_LABELS[rec.approvedStatus]}</strong>
                {rec.segment && <span className="text-muted-foreground">· {SEGMENT_LABELS[rec.segment]}</span>}
                {rec.role && <span className="text-muted-foreground">· {ROLE_LABELS[rec.role]}</span>}
                <button type="button" onClick={() => setEditing((e) => !e)} className="lux-cta-champagne ms-auto" style={{ minHeight: 44, padding: "0 18px", fontSize: 14 }}>
                  {editing ? "סגור" : "עדכן החלטה"}
                </button>
              </div>
              {rec.conflict && <p className="ux-note" style={{ color: "#ecdcb3" }}><AlertTriangle className="size-4 shrink-0" aria-hidden />{rec.conflict}</p>}
              {row.recCount > 1 && <p className="ux-note">לשם הזה יש {row.recCount} עותקים במטא — מוצגת ההמלצה של העותק שהוציא הכי הרבה.</p>}
              {editing && <ReviewEditor row={rec} apiToken={apiToken} onDone={() => { setEditing(false); onSaved(); }} />}
            </>
          ) : (
            <p className="text-[14px] text-muted-foreground">
              {loadingRec ? "טוען המלצה…" : "אין המלצה — מטא לא מכירה את מזהה המודעה, או שנתוני מטא לא זמינים כרגע. המספרים בשורה מגיעים מה-CRM ונכונים."}
            </p>
          )}
        </div>
        <div className="ux-box">
          <h3>מי נסגר</h3>
          {row.dealCustomers.length ? (
            <div className="ux-names won">{row.dealCustomers.map((n) => <span key={n}>{n}</span>)}</div>
          ) : (
            <p className="text-[14px] text-muted-foreground">עוד אף אחד.</p>
          )}
          <h3 style={{ marginTop: 14 }}>סומנו לידים טובים</h3>
          {row.goodLeadNames.length ? (
            <div className="ux-names">{row.goodLeadNames.map((n, i) => <span key={`${n}-${i}`}>{n}</span>)}</div>
          ) : (
            <p className="text-[14px] text-muted-foreground">עוד אף אחד.</p>
          )}
          {rec && (
            <p className="ux-note">
              <span className="ltr">Ad ID {rec.adId}</span>
              {rec.effectiveStatus ? ` · במטא: ${rec.effectiveStatus}` : ""}
            </p>
          )}
        </div>
      </div>
    </details>
  );
}

function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}
