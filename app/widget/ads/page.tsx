/**
 * Widget "מודעות" screen — which ad brings money, not just form fills.
 *
 * Redesigned per ui-ux-pro-max (docs/agent/mobile-ui.md → "UI design rules"):
 *   ?view=           (default) לטיפול עכשיו + KPIs + one collapsed row per ad
 *   ?view=meta       what reached Meta (per deal/lead) + connection health
 *   ?view=settings   legacy link — the test rules now live in the settings tab
 *                    (?tab=settings&section=ads); kept so old links still work.
 * Sub-tabs are plain <a> links on purpose: a full navigation fires the
 * settings screen's unsaved-changes guard, a client-side one would not.
 * Old values `recommendations` / `report` land on the default view.
 *
 * Deterministic (lib/analysis/ad-performance.ts, lib/ads/*), no LLM.
 * Recommendation only — nothing here writes to Meta.
 *
 * Auth: ?widget_token=<GHL_WIDGET_TOKEN>. Period via ?days=30|90 (default all).
 */
import { Settings } from "lucide-react";
import { widgetPageAuthed } from "@/lib/widget/page-auth";
import { buildAdPerformance } from "@/lib/analysis/ad-performance";
import { checkAdsHealth } from "@/lib/ads/ads-health";
import { buildServerTodo } from "@/lib/ads/overview";
import { getMetaReportingStatus } from "@/lib/meta/reporting-status";
import { hubHref } from "@/lib/widget/hub-link";
import { AdsHealthLine } from "@/components/ads/AdsHealthLine";
import { MetaReportPanel } from "@/components/ads/MetaReportPanel";
import { AdsOverview } from "@/components/ads/AdsOverview";
import { AdRecommendationSettingsView } from "@/components/ads/AdRecommendationSettingsView";
import { LuxShell, LuxTitle, LuxAccent } from "@/components/widget-ui/lux";
import { HubUrlSync } from "@/components/hub/HubUrlSync";

export const dynamic = "force-dynamic";

const PERIODS: { id: string; label: string }[] = [
  { id: "", label: "הכל" },
  { id: "90", label: "90 יום" },
  { id: "30", label: "30 יום" },
];

export default async function AdsWidgetPage({
  searchParams,
}: {
  searchParams: Promise<{ widget_token?: string; days?: string; view?: string }>;
}) {
  const { widget_token, days, view } = await searchParams;
  const token = widget_token ?? "";
  if (!(await widgetPageAuthed(token))) {
    return (
      <div dir="rtl" style={{ padding: 24, color: "#f87171" }}>
        <h2 style={{ marginTop: 0 }}>אין הרשאה</h2>
        <p>
          חסר / לא תקין <code>widget_token</code>.
        </p>
      </div>
    );
  }

  const active = view === "meta" || view === "settings" ? view : "ads";
  const period = days === "30" || days === "90" ? days : "";
  const href = (v: string, d = period) => {
    const p = new URLSearchParams({ widget_token: token });
    if (v !== "ads") p.set("view", v);
    if (d) p.set("days", d);
    return `/widget/ads?${p.toString()}`;
  };
  const settingsHref = hubHref(token, { tab: "settings", section: "ads" });

  const [health, reporting, report] = await Promise.all([
    checkAdsHealth().catch(() => null),
    getMetaReportingStatus().catch(() => null),
    active === "ads" ? buildAdPerformance({ sinceDays: period ? Number(period) : undefined }) : Promise.resolve(null),
  ]);
  const serverTodo = buildServerTodo(health, reporting);

  return (
    <LuxShell className="ux">
      <HubUrlSync view={active === "ads" ? null : active} />
      <LuxTitle
        overline="— Meta Ads"
        subtitle="איזו מודעה מביאה כסף, לא רק טפסים. המסך ממליץ בלבד — שום דבר לא משתנה במטא."
        aside={
          <div className="ux-chips">
            <a className="ux-chip ux-head-status" href={href("meta")}>
              <span className="ux-dot" data-tone={health?.ok ? undefined : "warn"} aria-hidden />
              {!health ? "מצב החיבורים לא ידוע" : health.ok ? "החיבורים תקינים" : health.problems === 1 ? "חיבור אחד דורש טיפול" : `${health.problems} חיבורים דורשים טיפול`}
            </a>
            {active === "ads" &&
              PERIODS.map((p) => (
                <a key={p.id || "all"} className="ux-chip" href={href("ads", p.id)} aria-current={period === p.id ? "true" : undefined}>
                  {p.label}
                </a>
              ))}
          </div>
        }
      >
        מודעות <LuxAccent>מטא.</LuxAccent>
      </LuxTitle>

      <nav className="ux-tabs" aria-label="תצוגות מודעות">
        <a href={href("ads")} aria-current={active === "ads" ? "page" : undefined}>מודעות</a>
        <a href={href("meta")} aria-current={active === "meta" ? "page" : undefined}>דיווח למטא</a>
        <a className="ux-tabs-end" href={settingsHref} target="_parent">
          <Settings className="size-4" aria-hidden /> כללי בדיקה
        </a>
      </nav>

      {active === "ads" && report && (
        <AdsOverview apiToken={token} report={report} serverTodo={serverTodo} metaHref={href("meta")} />
      )}

      {active === "meta" && (
        <div className="grid gap-5">
          {/* a broken connection explains everything below it — show it first */}
          {health && !health.ok && <AdsHealthLine health={health} />}
          {reporting ? (
            <MetaReportPanel reporting={reporting} />
          ) : (
            <p className="ux-note">לא הצלחתי לטעון את מצב הדיווח למטא — נסה לרענן.</p>
          )}
          {(!health || health.ok) && <AdsHealthLine health={health} />}
        </div>
      )}

      {active === "settings" && (
        <>
          <p className="ux-note" style={{ marginTop: 0, marginBottom: 16 }}>
            כללי הבדיקה עברו ללשונית הגדרות.{" "}
            <a href={settingsHref} target="_parent" style={{ color: "var(--lux-champagne)" }}>לפתוח שם</a>
          </p>
          <AdRecommendationSettingsView apiToken={token} />
        </>
      )}
    </LuxShell>
  );
}
