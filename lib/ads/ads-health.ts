/**
 * "Is everything in the מודעות tab working?" — one status for the whole tab.
 *
 * Eli (2026-09-18): "אני צריך לדעת אם משהו נופל … שיהיה דיווח אם משהו לא
 * מעודכן ונפל או לא מסונכרן". Every connection the tab depends on, in one
 * list, each with a plain-Hebrew reason when it is not OK:
 *   - reading ad spend from Meta (the daily ads-evidence job's last result),
 *   - reporting conversions to Meta (CAPI ping), lead→ad attribution,
 *     good-lead reporting (existing checks in lib/meta/health.ts),
 *   - Purchase reports for closed deals (a failure used to sit silently —
 *     סהר צור, 16/09),
 *   - the two daily jobs behind the tab, late or failed.
 * A broken job also reaches Eli on WhatsApp through the job watchdog; this is
 * the same truth, visible where he looks at ads.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { checkMetaHealth, type MetaHealthCheck } from "@/lib/meta/health";
import { checkJobs, type JobCheck } from "@/lib/observability/jobs";
import { RETRY_WINDOW_DAYS } from "@/lib/meta/purchase-retry";

export type AdsHealthCheck = MetaHealthCheck;

export interface AdsHealth {
  ok: boolean;
  problems: number;
  checks: AdsHealthCheck[];
}

export interface PurchaseRow {
  name: string;
  error: string;
  hasKey: boolean;
}

/** Pure — unit-tested. A deal without an attribution key is not a fault. */
export function purchaseCheck(rows: PurchaseRow[]): AdsHealthCheck {
  const retryable = rows.filter((r) => r.hasKey);
  return {
    key: "purchase",
    label: "דיווח עסקאות סגורות למטא",
    ok: retryable.length === 0,
    detail:
      retryable.length === 0
        ? "כל העסקאות מליד ממטא דווחו"
        : `${retryable.map((r) => r.name).join(", ")} — לא דווח (${retryable[0].error.slice(0, 80)}). ננסה שוב אוטומטית בריצה היומית בבוקר.`,
  };
}

const ageText = (min: number | null) =>
  min === null ? "אף פעם" : min < 90 ? `לפני ${Math.round(min)} דק׳` : min < 48 * 60 ? `לפני ${Math.round(min / 60)} שעות` : `לפני ${Math.round(min / 1440)} ימים`;

/** Pure — unit-tested. */
export function jobCheck(c: JobCheck | undefined, label: string): AdsHealthCheck {
  if (!c) return { key: `job:${label}`, label, ok: false, detail: "המשימה לא רשומה" };
  const ok = c.health === "ok";
  return {
    key: `job:${c.job}`,
    label,
    ok,
    detail:
      c.health === "failed"
        ? `נכשלה: ${c.state.lastError ?? "?"}`
        : c.health === "late"
          ? `לא רצה בזמן — ריצה מוצלחת אחרונה ${ageText(c.minutesSinceOk)}`
          : c.health === "never"
            ? "לא רצה אף פעם"
            : `רצה בהצלחה ${ageText(c.minutesSinceOk)}`,
  };
}

export async function checkAdsHealth(): Promise<AdsHealth> {
  const checks: AdsHealthCheck[] = [];

  const { checks: jobs } = await checkJobs();
  const byJob = new Map(jobs.map((j) => [j.job, j]));

  // Spend reading = the daily ads-evidence run, which fetches Meta exactly as
  // the screen does and records the Hebrew reason when it cannot.
  const ev = byJob.get("ads-evidence");
  checks.push({
    key: "meta-read",
    label: "קריאת הוצאות ולידים ממטא",
    ok: ev?.health === "ok",
    detail:
      ev?.health === "ok"
        ? `תקין — נבדק ${ageText(ev.minutesSinceOk)}`
        : ev?.state.lastError ?? jobCheck(ev, "").detail,
  });

  try {
    const meta = await checkMetaHealth();
    checks.push(...meta.checks.filter((c) => c.key !== "activity"));
  } catch (e) {
    checks.push({ key: "capi", label: "חיבור למטא (CAPI)", ok: false, detail: `הבדיקה נכשלה: ${e instanceof Error ? e.message : String(e)}` });
  }

  const pr = await db.execute<{ name: string | null; err: string; has_key: boolean }>(sql`
    SELECT DISTINCT ON (COALESCE(q.deal_group_id, q.id))
           COALESCE(l.name, q.manychat_sub_id) AS name,
           COALESCE(q.meta_purchase_error, 'לא נשלח בסגירת העסקה') AS err,
           (l.meta_leadgen_id IS NOT NULL OR l.meta_fbclid IS NOT NULL) AS has_key
    FROM factory_quote_requests q
    LEFT JOIN leads l ON trim(l.manychat_sub_id) = trim(q.manychat_sub_id)
    WHERE q.meta_purchase_sent_at IS NULL AND q.deleted_at IS NULL
      -- Failed, or never stamped at all (Elran, 03/09: the send was cut off
      -- mid-flight and left no trace). Same window as the daily retry.
      AND (q.meta_purchase_error IS NOT NULL
           OR (q.closed_deal_at > now() - make_interval(days => ${RETRY_WINDOW_DAYS})
               AND q.closed_deal_at < now() - interval '10 minutes'))
      -- A combined deal is reported once, on its primary member.
      AND NOT EXISTS (SELECT 1 FROM factory_quote_requests o
                      WHERE o.deal_group_id = q.deal_group_id AND o.meta_purchase_sent_at IS NOT NULL)`);
  checks.push(purchaseCheck(pr.rows.map((r) => ({ name: (r.name ?? "—").split("|")[0].trim(), error: r.err, hasKey: Boolean(r.has_key) }))));

  checks.push(jobCheck(byJob.get("enrich-meta-attribution"), "משימה יומית — שיוך ודיווח למטא"));
  checks.push(jobCheck(byJob.get("ads-evidence"), "משימה יומית — בדיקת נתוני מודעות"));

  const problems = checks.filter((c) => !c.ok).length;
  return { ok: problems === 0, problems, checks };
}
