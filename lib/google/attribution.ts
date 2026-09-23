/**
 * Which Google campaign / ad group / keyword a website lead's click came from —
 * the pure half (no DB, no network). The runner is `attribution-run.ts`.
 *
 * Source of truth: Google's `click_view` for the gclid. It is queryable one day
 * at a time and only 90 days back, so we try the lead's own day (Israel time,
 * the account's timezone) and the two days before — a click can precede the
 * form by a day or two. Verified 23/09 on the real account: every click row
 * carries campaign, ad group, keyword text and match type, and filtering by
 * `click_view.gclid` returns exactly one row.
 *
 * No gclid (iOS gbraid/wbraid), or gclid not in click_view → the Search
 * tracking template's `utm_content={adgroupid}` / `utm_term={keyword}`.
 * PMax has no ad group; its clicks carry the campaign only.
 */

export interface GoogleAttribution {
  campaignId: string | null;
  campaignName: string | null;
  adGroupId: string | null;
  adGroupName: string | null;
  keyword: string | null;
  matchType: string | null;
  clickDate: string | null;
  source: "click_view" | "utm";
}

/** YYYY-MM-DD in Asia/Jerusalem. */
export function israelDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** The lead's day and the two before it, newest first. */
export function candidateClickDates(createdAt: Date): string[] {
  const day = 86_400_000;
  return [0, 1, 2].map((n) => israelDate(new Date(createdAt.getTime() - n * day)));
}

/** A click id is a URL token — refuse anything that could break a GAQL string. */
export function safeClickId(id: string | null | undefined): string | null {
  return id && /^[A-Za-z0-9_\-.~]{10,300}$/.test(id) ? id : null;
}

/** A Search ad group id from utm_content, or null. */
export function adGroupIdFromUtm(utmContent: string | null | undefined): string | null {
  const s = utmContent?.trim();
  return s && /^\d{6,20}$/.test(s) ? s : null;
}

const str = (v: unknown) => (v === undefined || v === null || v === "" ? null : String(v));

export function fromClickRow(row: any): GoogleAttribution {
  return {
    campaignId: str(row?.campaign?.id),
    campaignName: str(row?.campaign?.name),
    adGroupId: str(row?.adGroup?.id),
    adGroupName: str(row?.adGroup?.name),
    keyword: str(row?.clickView?.keywordInfo?.text),
    matchType: str(row?.clickView?.keywordInfo?.matchType),
    clickDate: str(row?.segments?.date),
    source: "click_view",
  };
}

export function fromAdGroupRow(row: any, utmTerm: string | null): GoogleAttribution {
  return {
    campaignId: str(row?.campaign?.id),
    campaignName: str(row?.campaign?.name),
    adGroupId: str(row?.adGroup?.id),
    adGroupName: str(row?.adGroup?.name),
    keyword: utmTerm?.trim() || null,
    matchType: null,
    clickDate: null,
    source: "utm",
  };
}

/** A lead we could not attribute is marked not_found only once Google's data
 *  for its days is surely complete; before that we retry next run. */
export const NOT_FOUND_AFTER_DAYS = 3;

export function clickViewQuery(gclid: string, date: string): string {
  return `SELECT click_view.gclid, segments.date, campaign.id, campaign.name, ad_group.id, ad_group.name,
    click_view.keyword_info.text, click_view.keyword_info.match_type
    FROM click_view WHERE segments.date = '${date}' AND click_view.gclid = '${gclid}'`;
}

export function adGroupQuery(adGroupId: string): string {
  return `SELECT ad_group.id, ad_group.name, campaign.id, campaign.name FROM ad_group WHERE ad_group.id = ${adGroupId}`;
}
