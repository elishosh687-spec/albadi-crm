/**
 * Meta good-lead poller.
 *
 * Eli marks quality leads by adding the tag **"ליד טוב"** to a contact in the
 * GHL UI — his judgement, not a formula (his correction 2026-08-07: "got a
 * quote" is a pipeline step, not a quality signal; the good ones are "a real
 * business that wanted serious volume and talked straight"). This poller asks
 * GHL which contacts carry that tag and reports a Meta `Qualified` conversion
 * for each, once.
 *
 * Why polling instead of a GHL Workflow webhook: the tag→lead_tags sync isn't
 * actually in use (2 tag rows in the whole DB), and a Workflow would need the
 * inbound secret pasted into a header. Polling needs no GHL-side setup at all —
 * Eli just tags. See memory meta-conversion-loop.
 */
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { leads } from "@/drizzle/schema";
import { searchContactsByTag } from "@/integrations/ghl/client";
import { sendMetaCrmEvent } from "@/lib/meta/capi";

/** Tag spellings Eli might use. All mean the same thing. */
export const GOOD_LEAD_TAGS = ["ליד טוב", "ליד_טוב", "good lead", "qualified"];

export interface GoodLeadPollResult {
  tagged: number;
  matched: number;
  sent: number;
  failed: number;
  errors: string[];
}

export async function pollGoodLeads(
  opts: { dry?: boolean } = {}
): Promise<GoodLeadPollResult> {
  // 1. Every contact carrying any good-lead tag.
  const contactIds = new Set<string>();
  for (const tag of GOOD_LEAD_TAGS) {
    try {
      const rows = await searchContactsByTag(tag);
      rows.forEach((c) => c.id && contactIds.add(c.id));
    } catch (e) {
      console.warn(`[good-lead-poll] search failed for '${tag}'`, e);
    }
  }
  if (contactIds.size === 0) {
    return { tagged: 0, matched: 0, sent: 0, failed: 0, errors: [] };
  }

  // 2. Map to our leads — only those with a leadgen id and not already reported.
  const ids = [...contactIds];
  const res = await db.execute<{ sid: string; name: string | null }>(sql`
    SELECT manychat_sub_id AS sid, name
    FROM leads
    WHERE ghl_contact_id = ANY(${sql.raw(
      `ARRAY[${ids.map((i) => `'${i.replace(/'/g, "''")}'`).join(",")}]::text[]`
    )})
      AND meta_leadgen_id IS NOT NULL
      AND meta_qualified_sent_at IS NULL`);
  const pending = res.rows;

  if (opts.dry) {
    return {
      tagged: contactIds.size,
      matched: pending.length,
      sent: 0,
      failed: 0,
      errors: pending.map((p) => p.name ?? p.sid),
    };
  }

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const p of pending) {
    const r = await sendMetaCrmEvent(p.sid, "Qualified", {
      eventId: `${p.sid.trim()}:Qualified`,
    });
    if (r.ok) {
      sent++;
      await db
        .update(leads)
        .set({ metaQualifiedSentAt: new Date() })
        .where(sql`trim(${leads.manychatSubId}) = ${p.sid.trim()}`);
    } else {
      failed++;
      errors.push(`${p.name ?? p.sid}: ${r.error ?? r.skipped}`);
    }
  }

  return { tagged: contactIds.size, matched: pending.length, sent, failed, errors: errors.slice(0, 10) };
}
