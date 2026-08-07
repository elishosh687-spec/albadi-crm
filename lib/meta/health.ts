/**
 * Meta conversion-loop health — "how do I know it's still working?"
 *
 * The loop is quiet by design: nothing errors visibly when it breaks, it just
 * stops teaching Meta anything. This computes the few checks that actually
 * catch a break, so the מודעות tab can show a status line and Eli knows where
 * to look instead of discovering it months later. See memory meta-conversion-loop.
 */
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { metaCapiConfigured } from "@/lib/meta/capi";
import { searchContactsByTag } from "@/integrations/ghl/client";
import { GOOD_LEAD_TAGS } from "@/lib/meta/good-lead-poll";

export interface MetaHealthCheck {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface MetaHealth {
  ok: boolean;
  checks: MetaHealthCheck[];
}

export async function checkMetaHealth(): Promise<MetaHealth> {
  const checks: MetaHealthCheck[] = [];

  // 1. Can we talk to Meta at all?
  checks.push({
    key: "capi",
    label: "חיבור למטא (CAPI)",
    ok: metaCapiConfigured(),
    detail: metaCapiConfigured()
      ? "טוקן ודאטהסט מוגדרים"
      : "חסר META_CAPI_TOKEN או META_DATASET_ID — שום אירוע לא נשלח",
  });

  // 2. Attribution coverage: FB leads that never got a leadgen id can never be
  //    reported. A creeping number here means the sheet enrichment is broken.
  const cov = await db.execute<{ total: number; missing: number; recent_missing: number }>(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE meta_leadgen_id IS NULL)::int AS missing,
           count(*) FILTER (WHERE meta_leadgen_id IS NULL
                              AND created_at > now() - interval '14 days')::int AS recent_missing
    FROM leads
    WHERE source = 'facebook_import' OR lead_source = 'facebook'`);
  const c = cov.rows[0];
  const missing = Number(c?.missing ?? 0);
  const recentMissing = Number(c?.recent_missing ?? 0);
  checks.push({
    key: "attribution",
    label: "שיוך לידים למודעה",
    // Old unmatchable rows (bad phones) are fine; NEW ones mean the cron broke.
    ok: recentMissing === 0,
    detail:
      recentMissing === 0
        ? `${Number(c?.total ?? 0) - missing}/${c?.total ?? 0} משויכים (${missing} ישנים ללא התאמה)`
        : `${recentMissing} לידים מ-14 הימים האחרונים ללא מזהה — כנראה ה-cron היומי לא רץ`,
  });

  // 3. Does the good-lead tag actually reach us, and did everything tagged get
  //    reported? A tagged-but-unsent backlog is the classic silent failure.
  let tagged = 0;
  let tagError: string | null = null;
  try {
    const ids = new Set<string>();
    for (const t of GOOD_LEAD_TAGS) {
      (await searchContactsByTag(t)).forEach((x) => x.id && ids.add(x.id));
    }
    tagged = ids.size;
  } catch (e) {
    tagError = e instanceof Error ? e.message : String(e);
  }
  const sentRes = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM leads WHERE meta_qualified_sent_at IS NOT NULL`);
  const sent = Number(sentRes.rows[0]?.n ?? 0);
  checks.push({
    key: "goodlead",
    label: 'תגית "ליד טוב" → מטא',
    ok: tagError === null && tagged <= sent,
    detail: tagError
      ? `לא הצלחנו לשאול את GHL: ${tagError}`
      : tagged === 0
        ? "אין לידים מתויגים כרגע"
        : tagged <= sent
          ? `${tagged} מתויגים, כולם דווחו`
          : `${tagged} מתויגים אך רק ${sent} דווחו — ה-cron כנראה לא רץ`,
  });

  // 4. Is anything flowing at all lately? Silence for weeks = look into it.
  const last = await db.execute<{ last: string | null }>(sql`
    SELECT max(meta_qualified_sent_at)::text AS last FROM leads`);
  const lastSent = last.rows[0]?.last ?? null;
  checks.push({
    key: "activity",
    label: "דיווח אחרון למטא",
    ok: true, // informational
    detail: lastSent ? lastSent.slice(0, 16) : "עדיין לא דווח אף ליד טוב",
  });

  return { ok: checks.every((x) => x.ok), checks };
}
