/**
 * "This lead came from the website" — recognised from the WhatsApp prefill.
 *
 * The site's WhatsApp buttons open wa.me with a prefilled sentence (see
 * `whatsappHref` in the albadi-web repo, lib/contact.ts). That sentence is the
 * ONLY signal we get: the customer lands on the same number as everyone else,
 * so without reading it a website lead is indistinguishable from any other cold
 * inbound. Before this existed, 58 of 89 WhatsApp-origin leads had no source at
 * all and there was no way to tell whether the site was producing anything.
 *
 * Matching is on a distinctive fragment, not the whole string, because the
 * customer can edit the text in WhatsApp before hitting send — people routinely
 * add "היי" or trim the end. Keep these fragments in sync with the site copy
 * (lib/i18n/he.ts / en.ts `whatsappPrefill`, and the two landing constants).
 */
import { db } from "@/lib/db";
import { leads, sourceTouches } from "@/drizzle/schema";
import { sql } from "drizzle-orm";

export interface WebsiteOrigin {
  /** Which button they pressed — useful on its own. */
  kind: "page_cta" | "landing_google" | "after_lead_form";
  /** The page name the site interpolated, when the sentence carried one. */
  page: string | null;
}

/** Distinctive fragment → which button it belongs to. */
const SIGNATURES: { fragment: string; kind: WebsiteOrigin["kind"] }[] = [
  // 'היי, הרגע השארתי פרטים באתר ואשמח להתקדם להצעת מחיר'
  { fragment: "הרגע השארתי פרטים באתר", kind: "after_lead_form" },
  // 'היי, הגעתי מגוגל ואשמח להצעת מחיר לשקיות אלבד ממותגות'
  { fragment: "הגעתי מגוגל", kind: "landing_google" },
  // 'היי, אני בעמוד "{page}" באתר ואשמח להצעת מחיר לשקיות אלבד ממותגות'
  { fragment: "באתר ואשמח להצעת מחיר", kind: "page_cta" },
  // 'Hi, I am on the "{page}" page and would like a quote for branded non-woven bags'
  { fragment: "would like a quote for branded non-woven bags", kind: "page_cta" },
  { fragment: "i am on the", kind: "page_cta" },
];

/** Page name lives between the quotes the site puts around it. */
function extractPage(text: string): string | null {
  const m = text.match(/["“”']([^"“”']{1,60})["“”']/);
  return m ? m[1].trim() || null : null;
}

/**
 * Pure — no DB. Returns null when the message is not a website prefill.
 */
export function detectWebsiteOrigin(text: string | null | undefined): WebsiteOrigin | null {
  if (!text) return null;
  const t = text.trim();
  if (!t) return null;
  const hay = t.toLowerCase();
  for (const sig of SIGNATURES) {
    if (hay.includes(sig.fragment.toLowerCase())) {
      return { kind: sig.kind, page: extractPage(t) };
    }
  }
  return null;
}

/**
 * Stamp the lead as website-sourced and log the touch.
 *
 * `lead_source` is only filled when it is still empty — a lead already
 * attributed to facebook/google keeps that attribution; the website prefill is
 * a later touch, not a re-attribution. The `source_touches` row is always
 * written, so the full journey stays visible.
 *
 * Never throws: attribution must not be able to break an inbound reply.
 */
export async function recordWebsiteOrigin(
  sid: string,
  origin: WebsiteOrigin,
): Promise<void> {
  try {
    await db
      .update(leads)
      .set({
        leadSource: sql`COALESCE(${leads.leadSource}, 'website')`,
        updatedAt: new Date(),
      })
      .where(sql`trim(${leads.manychatSubId}) = ${sid.trim()}`);

    await db.insert(sourceTouches).values({
      manychatSubId: sid.trim(),
      sourcePrimary: "website",
      sourceDetail1: origin.kind,
      sourceDetail2: origin.page,
      recordSource: "whatsapp_prefill",
    });
    console.log(
      `[origin.website] ${sid} → ${origin.kind}${origin.page ? ` (${origin.page})` : ""}`,
    );
  } catch (e) {
    console.warn("[origin.website] failed to record (ignored)", e);
  }
}
