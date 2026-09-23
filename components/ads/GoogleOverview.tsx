"use client";

/**
 * "מודעות ← גוגל ← קמפיינים" — the Google twin of AdsOverview, deliberately
 * separate (Eli, 23/09: two worlds). Same shape so it reads the same:
 * 1. לטיפול עכשיו — red lines of the Google status list only;
 * 2. four KPIs with their meaning in words;
 * 3. one collapsed row per campaign; ad groups, keywords, money and names
 *    open on tap.
 *
 * No recommendations yet (no Google engine, no approved gates) — the pill is
 * the campaign's status in Google. Spend unknown shows "—", never ₪0.
 * Nothing here writes to Google Ads.
 */
import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, Target } from "lucide-react";
import type { GoogleCampaignRow, GooglePerformanceReport } from "@/lib/ads/google-performance";
import type { TodoItem } from "@/lib/ads/overview";
import { oneIn } from "@/lib/ads/overview";

const ils = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : `${n < 0 ? "−" : ""}₪${Math.abs(Math.round(n)).toLocaleString("he-IL")}`;
const ils2 = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `₪${(Math.round(n * 100) / 100).toLocaleString("he-IL")}`);

const STATUS: Record<string, { tone: "good" | "idle" | "warn"; label: string }> = {
  ENABLED: { tone: "good", label: "פעיל" },
  PAUSED: { tone: "idle", label: "מושהה" },
  REMOVED: { tone: "idle", label: "הוסר" },
};
const CHANNEL: Record<string, string> = { SEARCH: "חיפוש", PERFORMANCE_MAX: "Performance Max", DISPLAY: "רשת המדיה", VIDEO: "וידאו" };
const MATCH: Record<string, string> = { EXACT: "מדויק", PHRASE: "ביטוי", BROAD: "רחב" };

type Sort = "revenue" | "won" | "suitable" | "leads" | "spend";
const SORTS: { id: Sort; label: string }[] = [
  { id: "revenue", label: "הכנסה" },
  { id: "won", label: "עסקאות" },
  { id: "suitable", label: "לידים מתאימים" },
  { id: "leads", label: "לידים" },
  { id: "spend", label: "הוצאה" },
];

export function GoogleOverview({
  report,
  todo,
  healthHref,
  refreshHref,
  targetCplIls,
  maxCacIls,
}: {
  report: GooglePerformanceReport;
  todo: TodoItem[];
  healthHref: string;
  refreshHref: string;
  targetCplIls: number | null;
  maxCacIls: number;
}) {
  const [sort, setSort] = useState<Sort>("revenue");
  const [showAllTodo, setShowAllTodo] = useState(false);
  const [showRest, setShowRest] = useState(false);

  const rows = useMemo(() => {
    const v = (r: GoogleCampaignRow) =>
      sort === "revenue" ? r.revenueIls : sort === "won" ? r.won : sort === "suitable" ? r.suitable : sort === "leads" ? r.leads : r.spendIls ?? 0;
    return [...report.rows].sort((a, b) => v(b) - v(a) || b.leads - a.leads);
  }, [report.rows, sort]);
  const leading = rows.filter((r) => r.leading);
  const rest = rows.filter((r) => !r.leading);
  const topRevenue = Math.max(1, ...rows.map((r) => r.revenueIls));
  const t = report.totals;
  const TODO_CAP = 4;
  const allTodo: TodoItem[] = [
    ...todo,
    ...(report.spendUnavailable
      ? [{ key: "g-spend", title: "אין נתוני הוצאה מגוגל — העלויות לא ידועות כרגע", detail: `${report.spendUnavailable}. המספרים מה-CRM (לידים, עסקאות) עדיין נכונים.`, target: "google-health" as const }]
      : []),
  ];
  const shownTodo = showAllTodo ? allTodo : allTodo.slice(0, TODO_CAP);

  return (
    <div>
      {allTodo.length === 0 ? (
        <section className="ux-todo ok" aria-label="לטיפול עכשיו">
          <h2>
            <CheckCircle2 className="size-4" aria-hidden /> אין כרגע משהו שדורש טיפול — כל החיבורים לגוגל תקינים.
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
                <a className="ux-btn" href={healthHref}>פרטים</a>
              </li>
            ))}
          </ol>
          {allTodo.length > TODO_CAP && (
            <button type="button" className="ux-btn" style={{ marginTop: 12 }} aria-expanded={showAllTodo} onClick={() => setShowAllTodo((v) => !v)}>
              {showAllTodo ? "הצג פחות" : `עוד ${allTodo.length - TODO_CAP}`}
            </button>
          )}
        </section>
      )}

      <div className="ux-kpis">
        <Kpi k="לידים מגוגל" v={t.leads.toLocaleString("he-IL")} e={t.clicks !== null ? <><b>{t.clicks.toLocaleString("he-IL")}</b> קליקים בתקופה</> : <>מכל הקמפיינים בתקופה</>} />
        <Kpi k="לידים מתאימים" v={t.suitable.toLocaleString("he-IL")} e={oneIn(t.suitable, t.leads) ? <><b>{oneIn(t.suitable, t.leads)}</b> לידים</> : "עוד לא סומן ליד מתאים"} />
        <Kpi k="עסקאות שנסגרו" v={t.won.toLocaleString("he-IL")} e={oneIn(t.won, t.leads) ? <><b>{oneIn(t.won, t.leads)}</b> לידים</> : "עוד לא נסגרה עסקה"} />
        <Kpi
          k="הכנסה מגוגל"
          v={ils(t.revenueIls)}
          e={t.spendIls !== null ? <>הוצאה <b>{ils(t.spendIls)}</b> · נשאר <b>{ils(t.revenueIls - t.spendIls)}</b></> : "הוצאה לא ידועה"}
        />
      </div>

      <div className="ux-sechead">
        <h2>קמפיינים</h2>
        <div className="ux-chips">
          <label className="ux-select">
            מיון
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
              {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <a className="ux-btn" href={refreshHref} aria-label="רענן נתונים מגוגל">רענן</a>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="ux-panel" style={{ textAlign: "center", color: "var(--lux-muted)" }}>
          אין בתקופה הזו קמפיין שהוציא כסף או הביא ליד. נסה ״הכל״ בבחירת התקופה למעלה.
        </div>
      ) : (
        <div className="ux-list">
          <div className="ux-colhead" aria-hidden>
            <span>קמפיין</span><span>לידים</span><span>מתאימים</span><span>עסקאות</span><span>הכנסה</span><span>בגוגל</span><span />
          </div>
          {leading.length === 0 && (
            <div style={{ padding: "16px 18px", color: "var(--lux-muted)", fontSize: 14 }}>
              אף קמפיין עוד לא הביא עסקה או ליד מתאים בתקופה הזו.
            </div>
          )}
          {leading.map((r) => <CampaignRow key={r.id} row={r} topRevenue={topRevenue} targetCplIls={targetCplIls} maxCacIls={maxCacIls} />)}
          {rest.length > 0 && (
            <>
              <button type="button" className="ux-more" aria-expanded={showRest} onClick={() => setShowRest((v) => !v)}>
                <span>{showRest ? "הסתר קמפיינים בלי תוצאה" : `עוד ${rest.length} קמפיינים בלי תוצאה · ${rest.reduce((a, r) => a + r.leads, 0)} לידים`}</span>
                <ChevronDown className="size-4" style={{ transform: showRest ? "rotate(180deg)" : undefined }} aria-hidden />
              </button>
              {showRest && rest.map((r) => <CampaignRow key={r.id} row={r} topRevenue={topRevenue} targetCplIls={targetCplIls} maxCacIls={maxCacIls} />)}
            </>
          )}
        </div>
      )}

      {report.unattributed.total > 0 && (
        <p className="ux-note">
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {report.unattributed.total} לידים מגוגל בלי שיוך לקמפיין — לא נספרים בטבלה
          {[
            report.unattributed.whatsapp ? `${report.unattributed.whatsapp} פנו בוואטסאפ מהאתר (אין להם מזהה קליק)` : "",
            report.unattributed.pending ? `${report.unattributed.pending} ממתינים לשיוך הלילי` : "",
            report.unattributed.notFound ? `${report.unattributed.notFound} עם קליק שגוגל לא מכירה` : "",
            report.unattributed.noClick ? `${report.unattributed.noClick} מסומנים ״גוגל״ בלי מזהה קליק` : "",
          ].filter(Boolean).map((s) => ` · ${s}`).join("")}
          .
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

function CampaignRow({ row, topRevenue, targetCplIls, maxCacIls }: { row: GoogleCampaignRow; topRevenue: number; targetCplIls: number | null; maxCacIls: number }) {
  const st = STATUS[row.status ?? ""] ?? { tone: "idle" as const, label: row.status ?? "לא ידוע" };
  const dash = (n: number) => (n > 0 ? n.toLocaleString("he-IL") : "—");
  const thin = row.clicks !== null && row.clicks < 30;
  return (
    <details className="ux-row">
      <summary>
        <div>
          <div className="name">{row.name}</div>
          <div className="sub">{CHANNEL[row.channel ?? ""] ?? row.channel ?? "קמפיין"}{row.spendIls !== null ? ` · הוצאה ${ils(row.spendIls)}` : ""}</div>
          {row.revenueIls > 0 && (
            <div className="ux-bar" aria-hidden><i style={{ width: `${Math.max(3, (row.revenueIls / topRevenue) * 100)}%` }} /></div>
          )}
        </div>
        <div className="m">{row.leads.toLocaleString("he-IL")}</div>
        <div className={`m${row.suitable ? "" : " none"}`}>{dash(row.suitable)}</div>
        <div className={`m${row.won ? "" : " none"}`}>{dash(row.won)}</div>
        <div className={`m${row.revenueIls ? " money" : " none"}`}>{row.revenueIls ? ils(row.revenueIls) : "—"}</div>
        <span className="ux-pill" data-tone={st.tone}>{st.label}</span>
        <ChevronDown className="chev size-4" aria-hidden />
        <div className="mline">
          <span><b>{row.leads}</b> לידים</span>
          <span><b>{row.suitable}</b> מתאימים</span>
          <span><b>{row.won}</b> עסקאות</span>
          {row.revenueIls > 0 && <span className="g">{ils(row.revenueIls)}</span>}
        </div>
      </summary>

      <div className="ux-detail">
        <div className="ux-box">
          <h3>כסף ותוצאות</h3>
          <div className="ux-metrics">
            <Metric k="הוצאה" v={row.spendIls === null ? "לא ידוע" : ils(row.spendIls)} />
            <Metric k="קליקים" v={row.clicks === null ? "—" : row.clicks.toLocaleString("he-IL")} />
            <Metric k={`עלות לליד (CPL)${targetCplIls !== null ? ` · יעד ${ils(targetCplIls)}` : ""}`} v={ils2(row.cplIls)} />
            <Metric k={`עלות ללקוח (CAC) · תקרה ${ils(maxCacIls)}`} v={ils(row.cacIls)} />
            <Metric k="רווח אחרי פרסום" v={ils(row.profitAfterAdsIls)} />
            <Metric k="המרות שגוגל ספרה" v={row.googleConversions === null ? "—" : String(Math.round(row.googleConversions * 10) / 10)} />
          </div>
          {thin && (
            <p className="ux-note" style={{ color: "#ecdcb3" }}>
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              {row.clicks} קליקים בלבד — המספרים כאן הם כיוון, לא מסקנה (פחות מ-30 קליקים).
            </p>
          )}
          {row.adGroups.length > 0 && (
            <>
              <h3 style={{ marginTop: 14 }}>קבוצות מודעות</h3>
              <div style={{ overflowX: "auto" }}>
                <table className="ux-table" aria-label="קבוצות מודעות">
                  <thead>
                    <tr><th>קבוצה</th><th className="n">הוצאה</th><th className="n">קליקים</th><th className="n">לידים</th><th className="n">מתאימים</th><th className="n">עסקאות</th></tr>
                  </thead>
                  <tbody>
                    {row.adGroups.map((g) => (
                      <tr key={g.id}>
                        <td>{g.name}</td>
                        <td className="n">{ils(g.spendIls)}</td>
                        <td className="n">{g.clicks ?? "—"}</td>
                        <td className="n">{g.leads}</td>
                        <td className="n">{g.suitable || "—"}</td>
                        <td className="n">{g.won || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {row.keywords.length > 0 && (
            <>
              <h3 style={{ marginTop: 14 }}>מילות המפתח שהביאו לידים</h3>
              <ul className="ux-rlist">
                {row.keywords.map((k) => (
                  <li key={`${k.text}|${k.matchType}`} className="ux-rrow">
                    <div className="who">
                      <span className="name">{k.text}</span>
                      <span className="note">{MATCH[k.matchType ?? ""] ?? k.matchType ?? ""}</span>
                    </div>
                    <span className="val">{k.leads} לידים{k.suitable ? ` · ${k.suitable} מתאימים` : ""}{k.won ? ` · ${k.won} עסקאות` : ""}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <div className="ux-box">
          <h3>מי נסגר</h3>
          {row.dealCustomers.length ? (
            <div className="ux-names won">{row.dealCustomers.map((n) => <span key={n}>{n}</span>)}</div>
          ) : (
            <p className="text-[14px] text-muted-foreground">עוד אף אחד.</p>
          )}
          <h3 style={{ marginTop: 14 }}>לידים מתאימים</h3>
          {row.suitableNames.length ? (
            <div className="ux-names">{row.suitableNames.map((n, i) => <span key={`${n}-${i}`}>{n}</span>)}</div>
          ) : (
            <p className="text-[14px] text-muted-foreground">עוד אף אחד.</p>
          )}
          <p className="ux-note"><span className="ltr">Campaign ID {row.id}</span> · בגוגל: {STATUS[row.status ?? ""]?.label ?? row.status ?? "לא ידוע"}</p>
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
