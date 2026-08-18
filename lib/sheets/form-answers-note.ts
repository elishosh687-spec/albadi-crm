/**
 * Mirror the Meta Instant-Form answers onto the lead's GHL contact as a note.
 *
 * The form is the customer's FIRST statement of what they want — "how many
 * units", "do you have a logo" — and it arrived before anyone spoke to them.
 * Until now it landed in the Google Sheet and stopped there: the Apps Script
 * forwards only name and phone, so a salesperson opening the contact in GHL
 * saw none of it.
 *
 * Sibling of lib/autoresponder/ghl-questionnaire-note.ts (the WhatsApp
 * questionnaire). Two notes, deliberately separate: this one is what they said
 * to the ad, that one is what they said to the bot, and the difference between
 * them is often the interesting part.
 *
 * Idempotent via `leads.meta_form_note_at` plus a marker check on the contact,
 * so a re-run posts nothing even if the stamp was lost.
 */
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { addContactNote, listContactNotes } from "@/integrations/ghl/client";

const MARKER = "[טופס מטא v1]";

export interface FormNoteResult {
  candidates: number;
  posted: number;
  skipped: number;
  errors: string[];
}

function renderNote(
  answers: Record<string, string>,
  meta: { adName: string | null; campaignName: string | null; createdAt: string | null },
): string {
  const lines = [MARKER, "📝 *מה הלקוח מילא בטופס במטא*", ""];
  for (const [label, value] of Object.entries(answers)) {
    // Sheet headers arrive snake_cased by Meta ("שם_החברה") — read them as text.
    lines.push(`• ${label.replace(/_/g, " ")}: ${value}`);
  }
  const src = [meta.adName, meta.campaignName].filter(Boolean).join(" · ");
  if (src) lines.push("", `מודעה: ${src}`);
  if (meta.createdAt) lines.push(`נכנס: ${meta.createdAt.slice(0, 16).replace("T", " ")}`);
  return lines.join("\n");
}

export async function postFormAnswerNotes(limit = 50): Promise<FormNoteResult> {
  const out: FormNoteResult = { candidates: 0, posted: 0, skipped: 0, errors: [] };

  const res = await db.execute<{
    sid: string;
    contact_id: string;
    answers: Record<string, string>;
    ad_name: string | null;
    campaign_name: string | null;
    created_at: string | null;
  }>(sql`
    SELECT manychat_sub_id AS sid, ghl_contact_id AS contact_id,
           meta_form_answers AS answers, meta_ad_name AS ad_name,
           meta_campaign_name AS campaign_name, created_at::text AS created_at
    FROM leads
    WHERE meta_form_answers IS NOT NULL
      AND meta_form_note_at IS NULL
      AND ghl_contact_id IS NOT NULL
    ORDER BY created_at DESC
    LIMIT ${limit}`);

  out.candidates = res.rows.length;

  for (const r of res.rows) {
    try {
      const existing = await listContactNotes(r.contact_id).catch(() => []);
      if (existing.some((n) => (n.body ?? "").includes(MARKER))) {
        // Already there — stamp so we stop re-listing this contact every run.
        await db.execute(sql`
          UPDATE leads SET meta_form_note_at = now()
          WHERE trim(manychat_sub_id) = ${r.sid.trim()}`);
        out.skipped++;
        continue;
      }
      await addContactNote(
        r.contact_id,
        renderNote(r.answers, {
          adName: r.ad_name,
          campaignName: r.campaign_name,
          createdAt: r.created_at,
        }),
      );
      await db.execute(sql`
        UPDATE leads SET meta_form_note_at = now()
        WHERE trim(manychat_sub_id) = ${r.sid.trim()}`);
      out.posted++;
    } catch (e) {
      out.errors.push(`${r.sid}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return out;
}
