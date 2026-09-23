/**
 * Daily: fill `leads.google_campaign_* / ad_group_* / keyword` for website
 * leads that carry a Google click and are not attributed yet. Read-only toward
 * Google (GAQL SELECT via ads-client); writes only those CRM columns, and only
 * where `google_attributed_at IS NULL`.
 *
 * A Google failure aborts the run with the Hebrew reason (the job then fails
 * and the watchdog WhatsApps Eli) — a half-attributed run is not "done".
 * Pure rules: ./attribution.ts. Plan: docs/plans/2026-09-23-google-ads-tab-design.md.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { gaql, type FetchFn } from "./ads-client";
import {
  NOT_FOUND_AFTER_DAYS,
  adGroupIdFromUtm,
  adGroupQuery,
  candidateClickDates,
  clickViewQuery,
  fromAdGroupRow,
  fromClickRow,
  safeClickId,
  type GoogleAttribution,
} from "./attribution";

const BATCH = 200;

export interface AttributionRunResult {
  candidates: number;
  clickView: number;
  utm: number;
  notFound: number;
  retryLater: number;
}

type Candidate = {
  sid: string;
  created_at: string;
  google_gclid: string | null;
  utm_content: string | null;
  utm_term: string | null;
};

export async function runGoogleAttribution(opts: { fetchFn?: FetchFn; now?: Date } = {}): Promise<AttributionRunResult> {
  const now = opts.now ?? new Date();
  const res = await db.execute<Candidate>(sql`
    SELECT manychat_sub_id AS sid, created_at::text AS created_at, google_gclid, utm_content, utm_term
    FROM leads
    WHERE google_attributed_at IS NULL
      AND created_at > now() - interval '90 days'
      AND (google_gclid IS NOT NULL OR google_gbraid IS NOT NULL OR google_wbraid IS NOT NULL
           OR (lead_source = 'google' AND utm_content ~ '^[0-9]{6,20}$'))
    ORDER BY created_at DESC
    LIMIT ${BATCH}`);

  const out: AttributionRunResult = { candidates: res.rows.length, clickView: 0, utm: 0, notFound: 0, retryLater: 0 };
  const adGroupCache = new Map<string, any | null>();

  for (const lead of res.rows) {
    const createdAt = new Date(lead.created_at);
    let found: GoogleAttribution | null = null;

    const gclid = safeClickId(lead.google_gclid);
    if (gclid) {
      for (const date of candidateClickDates(createdAt)) {
        const r = await gaql(clickViewQuery(gclid, date), { fetchFn: opts.fetchFn });
        if (!r.ok) throw new Error(`שיוך קליקים מגוגל: ${r.reason}`);
        if (r.rows[0]) {
          found = fromClickRow(r.rows[0]);
          break;
        }
      }
    }

    const agId = !found ? adGroupIdFromUtm(lead.utm_content) : null;
    if (agId) {
      if (!adGroupCache.has(agId)) {
        const r = await gaql(adGroupQuery(agId), { fetchFn: opts.fetchFn });
        if (!r.ok) throw new Error(`שיוך קליקים מגוגל: ${r.reason}`);
        adGroupCache.set(agId, r.rows[0] ?? null);
      }
      const row = adGroupCache.get(agId);
      if (row) found = fromAdGroupRow(row, lead.utm_term);
    }

    if (found) {
      await db.execute(sql`
        UPDATE leads SET
          google_campaign_id = ${found.campaignId}, google_campaign_name = ${found.campaignName},
          google_ad_group_id = ${found.adGroupId}, google_ad_group_name = ${found.adGroupName},
          google_keyword = ${found.keyword}, google_match_type = ${found.matchType},
          google_click_date = ${found.clickDate}, google_attribution = ${found.source},
          google_attributed_at = now()
        WHERE manychat_sub_id = ${lead.sid} AND google_attributed_at IS NULL`);
      if (found.source === "click_view") out.clickView++;
      else out.utm++;
      continue;
    }

    const ageDays = (now.getTime() - createdAt.getTime()) / 86_400_000;
    if (ageDays >= NOT_FOUND_AFTER_DAYS) {
      await db.execute(sql`
        UPDATE leads SET google_attribution = 'not_found', google_attributed_at = now()
        WHERE manychat_sub_id = ${lead.sid} AND google_attributed_at IS NULL`);
      out.notFound++;
    } else {
      out.retryLater++;
    }
  }
  return out;
}
