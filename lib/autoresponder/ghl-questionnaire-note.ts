/**
 * Mirror the customer's questionnaire answers into a GHL contact note.
 *
 * The answers already exist in `leads.q_state`, and the raw WhatsApp thread is
 * mirrored into the GHL conversation — but neither is readable at a glance:
 * q_state stores `q3` / `p3` / `s2` / `"true"`, and the thread interleaves the
 * answers with the bot's questions, follow-ups and the quote. So a salesperson
 * opening the contact in GHL could not see what the customer actually asked
 * for without reconstructing it. This posts the spec as one note.
 *
 * Rendering goes through `renderAnswerLines` — the SAME function that builds
 * the confirmation message the customer approved on WhatsApp. A note that
 * disagreed with what the customer was shown would be worse than no note.
 *
 * Idempotent by content: the marker carries a hash of the answers, so a
 * re-run posts nothing while a genuine spec change (the customer edits at the
 * confirmation gate, or a later re-quote) posts a fresh note and leaves the
 * previous one as history. Same marker pattern as the call- and lead-analysis
 * notes.
 *
 * Non-fatal everywhere: this runs inside the customer-facing questionnaire
 * flow, and a GHL hiccup must never cost a customer their quote.
 */
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { sql } from "drizzle-orm";
import { addContactNote, listContactNotes } from "@/integrations/ghl/client";
import { renderAnswerLines, type QState } from "@/lib/autoresponder/questionnaire";

const MARKER = "[שאלון v1]";

/** Which fields make the spec — a change in any of them justifies a new note. */
function specHash(state: QState): string {
  const spec = [
    state.quantity, state.quantityCustom,
    state.product, state.productCustom,
    state.shipping, state.handles, state.lamination, state.colors,
    (state as { orderNotes?: string }).orderNotes,
  ].map((v) => v ?? "").join("|");
  return createHash("sha256").update(spec).digest("hex").slice(0, 8);
}

export type QuestionnaireNoteOutcome =
  | { ok: true; noteId: string }
  | { ok: false; skipped: "no_contact" | "no_answers" | "already_posted" }
  | { ok: false; error: string };

export async function postQuestionnaireNote(
  sid: string,
  state: QState,
): Promise<QuestionnaireNoteOutcome> {
  try {
    // A questionnaire that collected nothing has nothing worth mirroring.
    if (!state.quantity && !state.product) return { ok: false, skipped: "no_answers" };

    const rows = await db
      .select({ contactId: leads.ghlContactId, name: leads.name })
      .from(leads)
      .where(sql`trim(${leads.manychatSubId}) = ${sid.trim()}`)
      .limit(1);
    const contactId = rows[0]?.contactId;
    // FB-import syncs to GHL on insert, so this is rare — a lead whose GHL
    // push hasn't landed yet. The next spec change re-posts; no retry queue.
    if (!contactId) return { ok: false, skipped: "no_contact" };

    const marker = `${MARKER} h=${specHash(state)}`;
    const existing = await listContactNotes(contactId).catch(() => []);
    if (existing.some((n) => (n.body ?? "").includes(marker))) {
      return { ok: false, skipped: "already_posted" };
    }

    const routed = state.routedToFactory
      ? "מותאם אישית — נשלח לתמחור מפעל"
      : state.quoteResult
        ? "הצעה אוטומטית נשלחה"
        : "השאלון הושלם";
    const body = [
      marker,
      "📋 *תשובות הלקוח בשאלון*",
      "",
      ...renderAnswerLines(state),
      "",
      `סטטוס: ${routed}`,
      state.doneAt ? `הושלם: ${state.doneAt.slice(0, 16).replace("T", " ")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    const { id } = await addContactNote(contactId, body);
    return { ok: true, noteId: id };
  } catch (e) {
    console.warn("[q-note] failed", sid, e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
