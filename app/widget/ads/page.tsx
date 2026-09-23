/**
 * Widget "מודעות" screen — which ad brings money, not just form fills.
 *
 * Two worlds, one switch (Eli, 2026-09-23): מטא | גוגל. Each has its own
 * sub-tabs, its own status chip and its own settings section.
 *   Meta:   ?view=          (default) לטיפול עכשיו + KPIs + one row per ad
 *           ?view=meta      what reached Meta + connection health
 *           ?view=settings  legacy link — the rules live in ?tab=settings&section=ads
 *   Google: ?view=google         לטיפול עכשיו + KPIs + one row per campaign
 *           ?view=google-health  every Google check, in plain Hebrew
 *           rules: ?tab=settings&section=google-ads
 * The platform is carried by `view` so the hub's existing deep links work and
 * every old Meta link lands where it did. Sub-tabs are plain <a> links on
 * purpose: a full navigation fires the settings screen's unsaved-changes guard.
 *
 * Deterministic, no LLM. Recommendation/report only — nothing here writes to
 * Meta or to Google Ads.
 *
 * Auth: ?widget_token=<GHL_WIDGET_TOKEN>. Period via ?days=30|90 (default all).
 * ?fresh=1 re-reads Google now instead of the 10-minute cache.
 */
import { Settings } from "lucide-react";
import { widgetPageAuthed } from "@/lib/widget/page-auth";
import { buildAdPerformance } from "@/lib/analysis/ad-performance";
import { checkAdsHealth } from "@/lib/ads/ads-health";
import { buildGoogleTodo, buildServerTodo } from "@/lib/ads/overview";
import { getMetaReportingStatus } from "@/lib/meta/reporting-status";
import { cachedGoogleHealth } from "@/lib/ads/google-health";
import { buildGooglePerformance } from "@/lib/ads/google-performance";
import { getGooglePolicy } from "@/lib/ads/google-settings-store";
import { hubHref } from "@/lib/widget/hub-link";
import { AdsHealthLine } from "@/components/ads/AdsHealthLine";
import { MetaReportPanel } from "@/components/ads/MetaReportPanel";
import { AdsOverview } from "@/components/ads/AdsOverview";
import { GoogleOverview } from "@/components/ads/GoogleOverview";
import { AdRecommendationSettingsView } from "@/components/ads/AdRecommendationSettingsView";
import { LuxShell, LuxTitle, LuxAccent } from "@/components/widget-ui/lux";
import { HubUrlSync } from "@/components/hub/HubUrlSync";

export const dynamic = "force-dynamic";

const PERIODS: { id: string; label: string }[] = [
  { id: "", label: "הכל" },
  { id: "90", label: "90 יום" },
  { id: "30", label: "30 יום" },
];

type View = "ads" | "meta" | "settings" | "google" | "google-health";

export default async function AdsWidgetPage({
  searchParams,
}: {
  searchParams: Promise<{ widget_token?: string; days?: string; view?: string; fresh?: string }>;
}) {
  const { widget_token, days, view, fresh } = await searchParams;
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

  const active: View = view === "meta" || view === "settings" || view === "google" || view === "google-health" ? view : "ads";
  const google = active === "google" || active === "google-health";
  const period = days === "30" || days === "90" ? days : "";
  const isFresh = fresh === "1";
  const href = (v: View, d = period, extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ widget_token: token });
    if (v !== "ads") p.set("view", v);
    if (d) p.set("days", d);
    for (const [k, val] of Object.entries(extra)) p.set(k, val);
    return `/widget/ads?${p.toString()}`;
  };
  const metaSettingsHref = hubHref(token, { tab: "settings", section: "ads" });
  const googleSettingsHref = hubHref(token, { tab: "settings", section: "google-ads" });

  // Both platforms' health: the page shows its own chip, and a small mark on
  // the OTHER platform's switch when that one has a problem — never hidden.
  const [metaHealth, googleHealth, reporting, report, googleReport, googlePolicy] = await Promise.all([
    checkAdsHealth().catch(() => null),
    cachedGoogleHealth({ fresh: isFresh }).catch(() => null),
    !google ? getMetaReportingStatus().catch(() => null) : Promise.resolve(null),
    active === "ads" ? buildAdPerformance({ sinceDays: period ? Number(period) : undefined }) : Promise.resolve(null),
    active === "google" ? buildGooglePerformance({ sinceDays: period ? Number(period) : undefined, fresh: isFresh }).catch(() => null) : Promise.resolve(null),
    active === "google" ? getGooglePolicy().catch(() => null) : Promise.resolve(null),
  ]);
  const health = google ? googleHealth : metaHealth;
  const serverTodo = buildServerTodo(metaHealth, reporting);
  const showPeriods = active === "ads" || active === "google";

  return (
    <LuxShell className="ux">
      <HubUrlSync view={active === "ads" ? null : active} />
      <LuxTitle
        overline={google ? "— Google Ads" : "— Meta Ads"}
        subtitle={
          google
            ? "איזה קמפיין מביא כסף, לא רק קליקים. המסך מציג בלבד — שום דבר לא משתנה בגוגל."
            : "איזו מודעה מביאה כסף, לא רק טפסים. המסך ממליץ בלבד — שום דבר לא משתנה במטא."
        }
        aside={
          <div className="ux-chips">
            <a className="ux-chip ux-head-status" href={href(google ? "google-health" : "meta")}>
              <span className="ux-dot" data-tone={health?.ok ? undefined : "warn"} aria-hidden />
              {!health ? "מצב החיבורים לא ידוע" : health.ok ? "החיבורים תקינים" : health.problems === 1 ? "חיבור אחד דורש טיפול" : `${health.problems} חיבורים דורשים טיפול`}
            </a>
            {showPeriods &&
              PERIODS.map((p) => (
                <a key={p.id || "all"} className="ux-chip" href={href(active, p.id)} aria-current={period === p.id ? "true" : undefined}>
                  {p.label}
                </a>
              ))}
          </div>
        }
      >
        מודעות <LuxAccent>{google ? "גוגל." : "מטא."}</LuxAccent>
      </LuxTitle>

      <nav className="ux-tabs" aria-label="פלטפורמה" style={{ marginBottom: 8 }}>
        <a href={href("ads")} aria-current={!google ? "page" : undefined}>
          {google && metaHealth && !metaHealth.ok && <span className="ux-dot" data-tone="warn" aria-label="יש בעיה במטא" />}
          מטא
        </a>
        <a href={href("google")} aria-current={google ? "page" : undefined}>
          {!google && googleHealth && !googleHealth.ok && <span className="ux-dot" data-tone="warn" aria-label="יש בעיה בגוגל" />}
          גוגל
        </a>
      </nav>

      {google ? (
        <nav className="ux-tabs" aria-label="תצוגות גוגל">
          <a href={href("google")} aria-current={active === "google" ? "page" : undefined}>קמפיינים</a>
          <a href={href("google-health")} aria-current={active === "google-health" ? "page" : undefined}>חיבורים ומדידה</a>
          <a className="ux-tabs-end" href={googleSettingsHref} target="_parent">
            <Settings className="size-4" aria-hidden /> כללי גוגל
          </a>
        </nav>
      ) : (
        <nav className="ux-tabs" aria-label="תצוגות מטא">
          <a href={href("ads")} aria-current={active === "ads" ? "page" : undefined}>מודעות</a>
          <a href={href("meta")} aria-current={active === "meta" ? "page" : undefined}>דיווח למטא</a>
          <a className="ux-tabs-end" href={metaSettingsHref} target="_parent">
            <Settings className="size-4" aria-hidden /> כללי מטא
          </a>
        </nav>
      )}

      {active === "ads" && report && (
        <AdsOverview apiToken={token} report={report} serverTodo={serverTodo} metaHref={href("meta")} />
      )}

      {active === "meta" && (
        <div className="grid gap-5">
          {/* a broken connection explains everything below it — show it first */}
          {metaHealth && !metaHealth.ok && <AdsHealthLine health={metaHealth} />}
          {reporting ? (
            <MetaReportPanel reporting={reporting} />
          ) : (
            <p className="ux-note">לא הצלחתי לטעון את מצב הדיווח למטא — נסה לרענן.</p>
          )}
          {(!metaHealth || metaHealth.ok) && <AdsHealthLine health={metaHealth} />}
        </div>
      )}

      {active === "settings" && (
        <>
          <p className="ux-note" style={{ marginTop: 0, marginBottom: 16 }}>
            כללי הבדיקה עברו ללשונית הגדרות.{" "}
            <a href={metaSettingsHref} target="_parent" style={{ color: "var(--lux-champagne)" }}>לפתוח שם</a>
          </p>
          <AdRecommendationSettingsView apiToken={token} />
        </>
      )}

      {active === "google" &&
        (googleReport ? (
          <GoogleOverview
            report={googleReport}
            todo={buildGoogleTodo(googleHealth)}
            healthHref={href("google-health")}
            refreshHref={href("google", period, { fresh: "1" })}
            targetCplIls={googlePolicy?.settings.economics.targetCplIls ?? null}
            maxCacIls={googlePolicy?.settings.economics.maxCacIls ?? 500}
          />
        ) : (
          <p className="ux-note">לא הצלחתי לטעון את נתוני גוגל מה-CRM — נסה לרענן.</p>
        ))}

      {active === "google-health" && (
        <div className="grid gap-5">
          <AdsHealthLine health={googleHealth} />
          <section className="ux-panel" aria-label="איך נמדד">
            <h2>איך זה נמדד</h2>
            <p className="d">
              כל ליד מהאתר נשמר עם מזהה הקליק של גוגל (gclid). כל בוקר המערכת שואלת את גוגל מאיזה קמפיין,
              קבוצת מודעות ומילת מפתח הגיע הקליק, ורבע שעה אחר כך בודקת את כל השורות למעלה. שורה אדומה נשלחת אליך בוואטסאפ פעם אחת,
              ועוד פעם כשהיא מתוקנת. פער בין המרות שגוגל ספרה לבין לידים ב-CRM מוצג יום-יום — הוא ממצא, לא רעש.
            </p>
            <div className="ux-chips" style={{ marginTop: 12 }}>
              <a className="ux-btn" href={href("google-health", period, { fresh: "1" })}>בדוק עכשיו מול גוגל</a>
              <a className="ux-btn" href={googleSettingsHref} target="_parent">ספי ההתראות</a>
            </div>
          </section>
        </div>
      )}
    </LuxShell>
  );
}
