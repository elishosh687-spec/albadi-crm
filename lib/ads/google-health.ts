/**
 * "Is everything on the Google side working?" — the Google twin of
 * `ads-health.ts`, deliberately separate (its own status chip, its own job,
 * its own WhatsApp). Every check is a plain-Hebrew line: green, or red with a
 * reason.
 *
 * `evaluateGoogleHealth` is pure (unit-tested); `checkGoogleHealth` gathers
 * the facts — GAQL SELECTs only, CRM reads, and a GET of each live landing page.
 *
 * When Google itself cannot be read, only that line is red; the checks that
 * depend on it say "לא נבדק" instead of piling up five reds for one cause.
 *
 * Plan: docs/plans/2026-09-23-google-ads-tab-design.md (phase 3).
 */
import type { AdsHealth, AdsHealthCheck } from "./ads-health";
import type { GoogleAdsSettings } from "./google-settings";
import { sumDays, type GoogleSnapshot } from "./google-evidence";

export interface GoogleHealthFacts {
  today: string;
  read: { ok: true } | { ok: false; reason: string };
  autoTagging: boolean | null;
  snapshot: GoogleSnapshot | null;
  /** Enabled ads / asset groups in enabled campaigns that Google will not serve. */
  notServing: { campaign: string; what: string }[] | null;
  /** Changes Google applied by itself (auto-applied recommendations), last 7 days. */
  autoApplied: { at: string; campaign: string | null; resource: string }[] | null;
  /** Google's form conversions per closed day (conversion date). */
  formConversionsByDay: Map<string, number> | null;
  /** CRM website leads with a Google click, per Israel day. */
  crmFormLeadsByDay: Map<string, number>;
  /** All CRM Google leads in the clicks window. */
  crmLeadsInWindow: number;
  /** Google leads in the lookback window that did not get a campaign. */
  unattributedRecent: { notFound: number; names: string[] };
  /** Live landing pages and their HTTP status (null = unreachable). */
  landing: { url: string; status: number | null }[] | null;
  jobs: AdsHealthCheck[];
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function evaluateGoogleHealth(f: GoogleHealthFacts, s: GoogleAdsSettings): AdsHealth {
  const checks: AdsHealthCheck[] = [];
  const skipped = "לא נבדק — אין חיבור ל-Google Ads";
  const readOk = f.read.ok;

  checks.push({
    key: "google-read",
    label: "קריאת נתונים מ-Google Ads",
    ok: readOk && Boolean(f.snapshot?.ok),
    detail: !f.read.ok ? f.read.reason : f.snapshot && !f.snapshot.ok ? f.snapshot.reason : "תקין",
  });

  checks.push({
    key: "auto-tagging",
    label: "תיוג אוטומטי (gclid)",
    ok: !readOk || f.autoTagging !== false,
    detail: !readOk ? skipped : f.autoTagging ? "פעיל — כל קליק מקבל gclid" : "כבוי! בלי תיוג אוטומטי אין gclid ואי אפשר לשייך אף ליד לקמפיין",
  });

  // Enabled campaign that did not spend for N full days.
  {
    const camps = f.snapshot?.ok ? [...f.snapshot.campaigns.values()].filter((c) => c.status === "ENABLED") : [];
    const from = addDays(f.today, -s.alerts.noSpendDays);
    const silent = camps.filter((c) => sumDays(c.daily.filter((d) => d.date < f.today), from).costIls === 0);
    checks.push({
      key: "spend",
      label: "קמפיינים פעילים מוציאים",
      ok: !f.snapshot?.ok || silent.length === 0,
      detail: !f.snapshot?.ok
        ? skipped
        : camps.length === 0
          ? "אין קמפיין פעיל כרגע"
          : silent.length === 0
            ? `${camps.length} קמפיינים פעילים, כולם הוציאו`
            : `${silent.map((c) => c.name).join(", ")} — פעיל ולא הוציא שקל ${s.alerts.noSpendDays === 1 ? "אתמול" : `${s.alerts.noSpendDays} ימים`}. בדוק דחייה, תשלום או תקציב.`,
    });
  }

  checks.push({
    key: "serving",
    label: "מודעות ונכסים מאושרים",
    ok: !readOk || !f.notServing || f.notServing.length === 0,
    detail: !readOk || !f.notServing
      ? skipped
      : f.notServing.length === 0
        ? "אין מודעה או קבוצת נכסים פעילה שגוגל חוסמת"
        : f.notServing.slice(0, 4).map((n) => `${n.campaign}: ${n.what}`).join(" · "),
  });

  checks.push({
    key: "auto-applied",
    label: "שינויים שגוגל החילה לבד",
    ok: !readOk || !f.autoApplied || f.autoApplied.length === 0,
    detail: !readOk || !f.autoApplied
      ? skipped
      : f.autoApplied.length === 0
        ? "אין שינוי אוטומטי מהמלצות גוגל ב-7 הימים האחרונים"
        : `${f.autoApplied.length} שינויים מהמלצה אוטומטית — אחרון ${f.autoApplied[0].at.slice(0, 16)}${f.autoApplied[0].campaign ? ` ב-${f.autoApplied[0].campaign}` : ""}. בדוק ב-Google Ads → היסטוריית שינויים, ושקול לכבות החלה אוטומטית.`,
  });

  // Clicks without any CRM lead.
  {
    const from = addDays(f.today, -s.alerts.clicksWindowDays);
    const clicks = f.snapshot?.ok ? [...f.snapshot.campaigns.values()].reduce((a, c) => a + sumDays(c.daily, from).clicks, 0) : null;
    const bad = clicks !== null && clicks >= s.alerts.clicksWithoutLeadsMin && f.crmLeadsInWindow === 0;
    checks.push({
      key: "clicks-leads",
      label: "קליקים הופכים ללידים ב-CRM",
      ok: !bad,
      detail: clicks === null
        ? skipped
        : bad
          ? `${clicks} קליקים ב-${s.alerts.clicksWindowDays} ימים ואף ליד מגוגל לא נכנס ל-CRM — הטופס, המעקב או השליחה ל-CRM שבורים`
          : `${clicks} קליקים, ${f.crmLeadsInWindow} לידים מגוגל ב-${s.alerts.clicksWindowDays} ימים`,
    });
  }

  // Google's form conversions vs CRM leads, per closed day.
  {
    if (!f.formConversionsByDay) {
      checks.push({ key: "gap", label: "גוגל ↔ CRM — לידים מהטופס", ok: true, detail: skipped });
    } else {
      const days = [...Array(7)].map((_, i) => addDays(f.today, -(i + 1)));
      const off = days
        .map((d) => ({ d, g: Math.round(f.formConversionsByDay!.get(d) ?? 0), c: f.crmFormLeadsByDay.get(d) ?? 0 }))
        .filter((x) => Math.abs(x.g - x.c) > s.alerts.gapToleranceLeads);
      checks.push({
        key: "gap",
        label: "גוגל ↔ CRM — לידים מהטופס",
        ok: off.length === 0,
        detail: off.length === 0
          ? "7 הימים הסגורים האחרונים תואמים"
          : off.map((x) => `${x.d.slice(5)}: גוגל ${x.g} · CRM ${x.c}`).join(" · "),
      });
    }
  }

  checks.push({
    key: "attribution",
    label: "שיוך לידים לקמפיין",
    ok: f.unattributedRecent.notFound === 0,
    detail: f.unattributedRecent.notFound === 0
      ? `כל לידי גוגל מ-${s.alerts.attributionLookbackDays} הימים האחרונים שויכו או עוד בתהליך`
      : `${f.unattributedRecent.notFound} לידים עם קליק שגוגל לא מכירה${f.unattributedRecent.names.length ? ` (${f.unattributedRecent.names.slice(0, 3).join(", ")})` : ""} — gclid מחשבון אחר או משובש`,
  });

  checks.push({
    key: "landing",
    label: "דפי הנחיתה עונים",
    ok: !f.landing || f.landing.every((l) => l.status !== null && l.status < 400),
    detail: !f.landing
      ? skipped
      : f.landing.length === 0
        ? "אין מודעה פעילה — אין דף לבדוק"
        : f.landing.every((l) => l.status !== null && l.status < 400)
          ? `${f.landing.length} דפים עונים`
          : f.landing.filter((l) => l.status === null || l.status >= 400).map((l) => `${l.url} → ${l.status ?? "לא עונה"}`).join(" · "),
  });

  checks.push(...f.jobs);
  const problems = checks.filter((c) => !c.ok).length;
  return { ok: problems === 0, problems, checks };
}

// ---------------------------------------------------------------- gathering

export async function checkGoogleHealth(opts: { fresh?: boolean } = {}): Promise<AdsHealth> {
  const [{ gaql }, { fetchGoogleEvidence }, { getGooglePolicy }, { db }, { sql }, { checkJobs }, { jobCheck }, { israelDate }] =
    await Promise.all([
      import("@/lib/google/ads-client"),
      import("./google-evidence"),
      import("./google-settings-store"),
      import("@/lib/db"),
      import("drizzle-orm"),
      import("@/lib/observability/jobs"),
      import("./ads-health"),
      import("@/lib/google/attribution"),
    ]);
  const { settings: s } = await getGooglePolicy();
  const now = new Date();
  const today = israelDate(now);

  const cust = await gaql("SELECT customer.auto_tagging_enabled FROM customer");
  const read = cust.ok ? ({ ok: true } as const) : ({ ok: false, reason: cust.reason } as const);
  const snapshot = cust.ok ? await fetchGoogleEvidence({ fresh: opts.fresh }) : null;

  let notServing: GoogleHealthFacts["notServing"] = null;
  let autoApplied: GoogleHealthFacts["autoApplied"] = null;
  let formConversionsByDay: GoogleHealthFacts["formConversionsByDay"] = null;
  let landing: GoogleHealthFacts["landing"] = null;

  if (cust.ok) {
    const from7 = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
    const from8 = new Date(now.getTime() - 8 * 86_400_000).toISOString().slice(0, 10);
    const [ads, groups, changes, conv] = await Promise.all([
      gaql(`SELECT campaign.name, ad_group_ad.ad.id, ad_group_ad.ad.final_urls, ad_group_ad.policy_summary.approval_status
            FROM ad_group_ad WHERE campaign.status = 'ENABLED' AND ad_group.status = 'ENABLED' AND ad_group_ad.status = 'ENABLED'`),
      gaql(`SELECT campaign.name, asset_group.name, asset_group.primary_status, asset_group.final_urls
            FROM asset_group WHERE campaign.status = 'ENABLED' AND asset_group.status = 'ENABLED'`),
      gaql(`SELECT change_event.change_date_time, change_event.client_type, change_event.change_resource_type, campaign.name
            FROM change_event WHERE change_event.change_date_time >= '${from7}' AND change_event.change_date_time <= '${today} 23:59:59'
            AND change_event.client_type = 'GOOGLE_ADS_RECOMMENDATIONS' ORDER BY change_event.change_date_time DESC LIMIT 50`),
      gaql(`SELECT segments.date, segments.conversion_action, metrics.all_conversions_by_conversion_date
            FROM customer WHERE segments.date BETWEEN '${from8}' AND '${today}'`),
    ]);
    if (ads.ok && groups.ok) {
      notServing = [
        ...ads.rows
          .filter((r) => ["DISAPPROVED", "AREA_OF_INTEREST_ONLY"].includes(r.adGroupAd?.policySummary?.approvalStatus))
          .map((r) => ({ campaign: r.campaign?.name ?? "?", what: `מודעה ${r.adGroupAd?.ad?.id} נדחתה (${r.adGroupAd.policySummary.approvalStatus})` })),
        ...groups.rows
          .filter((r) => r.assetGroup?.primaryStatus === "NOT_ELIGIBLE")
          .map((r) => ({ campaign: r.campaign?.name ?? "?", what: `קבוצת הנכסים ${r.assetGroup?.name} לא כשירה להצגה` })),
      ];
      const urls = [...new Set<string>([
        ...ads.rows.flatMap((r) => r.adGroupAd?.ad?.finalUrls ?? []),
        ...groups.rows.flatMap((r) => r.assetGroup?.finalUrls ?? []),
      ])].slice(0, 10);
      landing = await Promise.all(
        urls.map(async (url) => {
          try {
            const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000) });
            return { url, status: r.status };
          } catch {
            return { url, status: null };
          }
        }),
      );
    }
    if (changes.ok) {
      autoApplied = changes.rows.map((r) => ({
        at: String(r.changeEvent?.changeDateTime ?? ""),
        campaign: r.campaign?.name ?? null,
        resource: String(r.changeEvent?.changeResourceType ?? ""),
      }));
    }
    if (conv.ok) {
      const action = `/conversionActions/${s.measurement.formConversionActionId}`;
      formConversionsByDay = new Map();
      for (const r of conv.rows) {
        if (!String(r.segments?.conversionAction ?? "").endsWith(action)) continue;
        const d = r.segments.date;
        formConversionsByDay.set(d, (formConversionsByDay.get(d) ?? 0) + Number(r.metrics?.allConversionsByConversionDate ?? 0));
      }
    }
  }

  const windowFrom = new Date(now.getTime() - s.alerts.clicksWindowDays * 86_400_000).toISOString();
  const lookFrom = new Date(now.getTime() - s.alerts.attributionLookbackDays * 86_400_000).toISOString();
  const [perDay, inWindow, unattr] = await Promise.all([
    db.execute<{ d: string; n: number }>(sql`
      SELECT to_char(created_at AT TIME ZONE 'Asia/Jerusalem', 'YYYY-MM-DD') AS d, count(*)::int AS n
      FROM leads WHERE source = 'website_import' AND manychat_sub_id NOT LIKE 'test:%'
        AND (google_gclid IS NOT NULL OR google_gbraid IS NOT NULL OR google_wbraid IS NOT NULL)
        AND created_at > now() - interval '9 days'
      GROUP BY 1`),
    db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM leads
      WHERE manychat_sub_id NOT LIKE 'test:%' AND created_at >= ${windowFrom}::timestamptz
        AND (lead_source = 'google' OR google_gclid IS NOT NULL OR google_gbraid IS NOT NULL OR google_wbraid IS NOT NULL)`),
    db.execute<{ name: string | null }>(sql`
      SELECT name FROM leads
      WHERE manychat_sub_id NOT LIKE 'test:%' AND created_at >= ${lookFrom}::timestamptz
        AND google_attribution = 'not_found'`),
  ]);

  const { checks: jobs } = await checkJobs();
  const byJob = new Map(jobs.map((j) => [j.job, j]));

  const facts: GoogleHealthFacts = {
    today,
    read,
    autoTagging: cust.ok ? Boolean(cust.rows[0]?.customer?.autoTaggingEnabled) : null,
    snapshot,
    notServing,
    autoApplied,
    formConversionsByDay,
    crmFormLeadsByDay: new Map(perDay.rows.map((r) => [r.d, Number(r.n)])),
    crmLeadsInWindow: Number(inWindow.rows[0]?.n ?? 0),
    unattributedRecent: {
      notFound: unattr.rows.length,
      names: unattr.rows.map((r) => (r.name ?? "").split("|")[0].trim()).filter(Boolean),
    },
    landing,
    jobs: [
      jobCheck(byJob.get("google-attribution"), "משימה יומית — שיוך לידים לקמפיינים"),
      jobCheck(byJob.get("google-ads-check"), "משימה יומית — בדיקת חיבורי גוגל"),
    ],
  };
  return evaluateGoogleHealth(facts, s);
}
