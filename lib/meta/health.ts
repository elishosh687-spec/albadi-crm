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
import { pingMetaDataset } from "@/lib/meta/capi";
import { pollGoodLeads } from "@/lib/meta/good-lead-poll";

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
  //
  // This used to assert metaCapiConfigured() — i.e. "the two env vars are
  // non-empty" — under the label "חיבור למטא", which stayed green through an
  // expired or revoked token, the one failure it exists to catch. It now makes
  // a real Graph call that reads the dataset back.
  const ping = await pingMetaDataset();
  checks.push({
    key: "capi",
    label: "חיבור למטא (CAPI)",
    ok: ping.ok,
    detail: ping.ok
      ? `מחובר לדאטהסט "${ping.datasetName ?? "?"}" — נבדק עכשיו`
      : ping.authFailed
        ? `הטוקן נדחה על ידי מטא (${ping.error}) — צריך לחדש את META_CAPI_TOKEN ב-Events Manager`
        : `אין תשובה ממטא: ${ping.error}`,
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
  // This used to compare the tagged count against the ALL-TIME sent count,
  // which is not the same population — so a lead that can never be reported
  // (no leadgen id and no fbclid) showed up as "the cron didn't run" and sent
  // you chasing the wrong thing. Ask the poller itself instead: it knows what
  // is genuinely pending versus what is unreportable, and why.
  let tagError: string | null = null;
  let poll: Awaited<ReturnType<typeof pollGoodLeads>> | null = null;
  try {
    poll = await pollGoodLeads({ dry: true });
  } catch (e) {
    tagError = e instanceof Error ? e.message : String(e);
  }
  const tagged = poll?.tagged ?? 0;
  const waiting = poll?.matched ?? 0;
  const stuck = poll?.unattributable ?? 0;
  checks.push({
    key: "goodlead",
    label: 'תגית "ליד טוב" → מטא',
    // Unreportable leads are a data gap to know about, not a broken pipe, so
    // they don't turn the strip red on their own — a real backlog does.
    ok: tagError === null && waiting === 0,
    detail: tagError
      ? `לא הצלחנו לשאול את GHL: ${tagError}`
      : tagged === 0
        ? "אין לידים מתויגים כרגע"
        : waiting > 0
          ? `${waiting} מתויגים ממתינים לדיווח — הפעל את ה-cron היומי`
          : stuck > 0
            ? `${tagged} מתויגים דווחו · ${stuck} ללא מזהה מטא (לא ניתנים לדיווח): ${(poll?.unattributableNames ?? []).slice(0, 3).join(", ")}`
            : `${tagged} מתויגים, כולם דווחו`,
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
