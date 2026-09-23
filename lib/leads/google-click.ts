/**
 * Google Ads click data carried by a website lead — the columns
 * `/api/leads/website-import` stores so the ads tab can tie a lead to a Google
 * campaign (plan: docs/plans/2026-09-23-google-ads-tab-design.md, phase 1).
 *
 * Until 2026-09-23 gclid/gbraid/wbraid/utm_* reached the CRM and were written
 * only into the free-text `notes` ("gclid: …"). `parseClickFromNotes` reads
 * that note back for the one-off backfill.
 *
 * Pure and client-safe: no DB, no env.
 */

export interface GoogleClickInput {
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  landingUrl?: string;
}

/** Column values for `leads`; null = nothing to store. */
export interface GoogleClickColumns {
  googleGclid: string | null;
  googleGbraid: string | null;
  googleWbraid: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmTerm: string | null;
  utmContent: string | null;
  landingUrl: string | null;
}

// A click id is a URL token; anything longer or with whitespace is not one.
const CLICK_ID = /^[A-Za-z0-9_\-.~]{10,300}$/;
const MAX_TEXT = 500;
const MAX_URL = 2000;

function clickId(v: string | undefined): string | null {
  const s = v?.trim();
  return s && CLICK_ID.test(s) ? s : null;
}

function text(v: string | undefined, max = MAX_TEXT): string | null {
  const s = v?.trim();
  return s ? s.slice(0, max) : null;
}

export function googleClickColumns(b: GoogleClickInput): GoogleClickColumns {
  return {
    googleGclid: clickId(b.gclid),
    googleGbraid: clickId(b.gbraid),
    googleWbraid: clickId(b.wbraid),
    utmSource: text(b.utmSource),
    utmMedium: text(b.utmMedium),
    utmCampaign: text(b.utmCampaign),
    utmTerm: text(b.utmTerm),
    utmContent: text(b.utmContent),
    landingUrl: text(b.landingUrl, MAX_URL),
  };
}

/**
 * Backfill: the click id the old code wrote into `notes`. The note held ONE
 * line `gclid: <id>` for whichever of gclid/gbraid/wbraid was present, so the
 * kind is unknown — a gbraid/wbraid is told apart by its shape only when the
 * landing URL in the same note names it. Returns the LAST website note's id
 * (a lead can carry several attribution blocks; the newest is appended last).
 */
export function parseClickFromNotes(notes: string | null | undefined): {
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  landingUrl: string | null;
} {
  const empty = { gclid: null, gbraid: null, wbraid: null, landingUrl: null };
  if (!notes) return empty;
  const ids = [...notes.matchAll(/^gclid:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  const id = clickId(ids.at(-1));
  if (!id) return empty;
  const urls = [...notes.matchAll(/^דף נחיתה:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  const landingUrl = text(urls.at(-1), MAX_URL);
  let kind: "gclid" | "gbraid" | "wbraid" = "gclid";
  if (landingUrl) {
    try {
      const q = new URL(landingUrl).searchParams;
      if (q.get("gbraid") === id) kind = "gbraid";
      else if (q.get("wbraid") === id) kind = "wbraid";
    } catch {
      // not a URL — keep gclid
    }
  }
  return { ...empty, [kind]: id, landingUrl };
}
