/**
 * Widget "מודעות" screen — per-ad lead quality.
 *
 * Answers "which ad brings money, not just form fills": leads vs how many
 * progressed, how many Eli marked "good lead", deals closed and revenue — per
 * Meta ad. Deterministic (see lib/analysis/ad-performance.ts), no LLM.
 *
 * Auth: ?widget_token=<GHL_WIDGET_TOKEN>. Period via ?days=30|90 (default all).
 */
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { buildAdPerformance } from "@/lib/analysis/ad-performance";
import Link from "next/link";

export const dynamic = "force-dynamic";

const INK = "#e6e1e0";
const MUTED = "#8a7f74";
const LINE = "rgba(230,225,224,0.08)";

const ils = (n: number) => `₪${n.toLocaleString("he-IL")}`;

/** Colour the progression rate: the whole point of the screen. */
function rateColor(pct: number, leads: number): string {
  if (leads < 5) return MUTED; // too small to judge
  if (pct >= 10) return "#7dd3a0";
  if (pct >= 5) return "#e0c68a";
  return "#e08a8a";
}

export default async function AdsWidgetPage({
  searchParams,
}: {
  searchParams: Promise<{ widget_token?: string; days?: string }>;
}) {
  const { widget_token, days } = await searchParams;
  const token = widget_token ?? "";
  if (!verifyWidgetToken(token)) {
    return (
      <div dir="rtl" style={{ padding: 24, color: "#f87171" }}>
        <h2 style={{ marginTop: 0 }}>אין הרשאה</h2>
        <p>
          חסר / לא תקין <code>widget_token</code>.
        </p>
      </div>
    );
  }

  const sinceDays = days === "30" ? 30 : days === "90" ? 90 : undefined;
  const report = await buildAdPerformance({ sinceDays });
  const { totals } = report;
  // Phase B columns only appear once Meta spend is actually available.
  const showSpend = report.totalSpendIls !== null;

  const periods: { id: string; label: string }[] = [
    { id: "", label: "הכל" },
    { id: "90", label: "90 יום" },
    { id: "30", label: "30 יום" },
  ];

  const th: React.CSSProperties = {
    textAlign: "right",
    padding: "8px 10px",
    fontSize: 12,
    fontWeight: 500,
    color: MUTED,
    borderBottom: `1px solid ${LINE}`,
    whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    padding: "10px",
    fontSize: 13,
    color: INK,
    borderBottom: `1px solid ${LINE}`,
    whiteSpace: "nowrap",
  };

  return (
    <div dir="rtl" style={{ padding: 16, color: INK }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 4,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
          איכות לידים לפי מודעה
        </h2>
        <div style={{ display: "flex", gap: 6, marginInlineStart: "auto" }}>
          {periods.map((p) => {
            const active = (days ?? "") === p.id;
            return (
              <Link
                key={p.id || "all"}
                href={`/widget/ads?widget_token=${encodeURIComponent(token)}${
                  p.id ? `&days=${p.id}` : ""
                }`}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  fontSize: 12,
                  textDecoration: "none",
                  border: `1px solid ${LINE}`,
                  background: active ? "rgba(230,225,224,0.08)" : "transparent",
                  color: active ? INK : MUTED,
                }}
              >
                {p.label}
              </Link>
            );
          })}
        </div>
      </div>
      <p style={{ margin: "0 0 14px", fontSize: 12.5, color: MUTED }}>
        לא כמה לידים — כמה מהם באמת התקדמו וסגרו. ״התקדמו״ = הגיעו לאפיון ומעלה.
      </p>

      {/* totals */}
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 14 }}>
        {[
          { k: "לידים", v: String(totals.leads) },
          { k: "התקדמו", v: String(totals.engaged) },
          { k: "סומנו טובים", v: String(totals.markedGood) },
          { k: "נסגרו", v: String(totals.won) },
          { k: "הכנסה", v: ils(totals.revenueIls) },
          ...(report.totalSpendIls !== null
            ? [
                { k: "עלות פרסום", v: ils(report.totalSpendIls) },
                {
                  k: "רווח גולמי",
                  v: ils(totals.revenueIls - report.totalSpendIls),
                },
              ]
            : []),
        ].map((s) => (
          <div key={s.k}>
            <div style={{ fontSize: 11.5, color: MUTED }}>{s.k}</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{s.v}</div>
          </div>
        ))}
      </div>

      {report.rows.length === 0 ? (
        <p style={{ color: MUTED, fontSize: 13 }}>
          אין עדיין נתוני מודעות לתקופה הזו.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 620 }}>
            <thead>
              <tr>
                <th style={th}>מודעה</th>
                <th style={th}>לידים</th>
                <th style={th}>התקדמו</th>
                <th style={th}>%</th>
                <th style={th}>סומנו טובים</th>
                <th style={th}>נסגרו</th>
                <th style={th}>הכנסה</th>
                {showSpend ? (
                  <>
                    <th style={th}>עלות</th>
                    <th style={th}>עלות/ליד איכותי</th>
                    <th style={th}>רווח</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((r) => (
                <tr key={r.adName}>
                  <td style={{ ...td, whiteSpace: "normal", maxWidth: 260 }}>
                    {/* Ad names are Latin/technical ("07_chain_cut") — inside an
                        RTL table they render mangled ("chain_cut_07") unless the
                        run is isolated. */}
                    <span style={{ unicodeBidi: "isolate", direction: "ltr", display: "inline-block" }}>
                      {r.adName}
                    </span>
                    {r.campaignName ? (
                      <div
                        style={{
                          fontSize: 11,
                          color: MUTED,
                          unicodeBidi: "isolate",
                        }}
                      >
                        {r.campaignName}
                      </div>
                    ) : null}
                  </td>
                  <td style={td}>{r.leads}</td>
                  <td style={td}>{r.engaged}</td>
                  <td
                    style={{
                      ...td,
                      color: rateColor(r.engagedPct, r.leads),
                      fontWeight: 600,
                    }}
                  >
                    {r.engagedPct}%
                  </td>
                  <td style={td}>{r.markedGood || "—"}</td>
                  <td style={td}>{r.won || "—"}</td>
                  <td style={{ ...td, fontWeight: r.revenueIls ? 600 : 400 }}>
                    {r.revenueIls ? ils(r.revenueIls) : "—"}
                  </td>
                  {showSpend ? (
                    <>
                      <td style={td}>
                        {r.spendIls !== null ? ils(r.spendIls) : "—"}
                      </td>
                      <td style={td}>
                        {r.costPerQualityLeadIls !== null
                          ? ils(r.costPerQualityLeadIls)
                          : "—"}
                      </td>
                      <td
                        style={{
                          ...td,
                          fontWeight: 600,
                          color:
                            r.roiIls === null
                              ? INK
                              : r.roiIls > 0
                                ? "#7dd3a0"
                                : "#e08a8a",
                        }}
                      >
                        {r.roiIls !== null ? ils(r.roiIls) : "—"}
                      </td>
                    </>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!showSpend && report.spendUnavailable ? (
        <p style={{ marginTop: 12, fontSize: 12, color: MUTED }}>
          עלויות פרסום לא מוצגות — {report.spendUnavailable}. להצגת עלות לליד
          איכותי ורווח, צריך <code>META_ADS_TOKEN</code> (System User token עם
          ads_read, כזה שלא פג).
        </p>
      ) : null}

      {report.unattributed > 0 ? (
        <p style={{ marginTop: 12, fontSize: 12, color: MUTED }}>
          {report.unattributed} לידים מפייסבוק ללא שיוך למודעה (לא נמצאה התאמה
          בגיליון הטופס).
        </p>
      ) : null}
    </div>
  );
}
