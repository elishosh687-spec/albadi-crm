/**
 * "New lead needs a call" task. Fires when a lead first reaches a stage that
 * needs human attention straight out of the questionnaire:
 *   - INTAKE       (standard quote sent)
 *   - FACTORY_WAIT (custom spec / large order — these SKIP intake, so without
 *     this they'd never land on the salesperson's board: the highest-value
 *     leads falling through the cracks)
 *
 * From there the salesperson drives the chain himself (call → mark done →
 * callback creates the next task). So this single entry trigger + the call
 * callbacks cover the whole funnel.
 *
 * Idempotent: a stable [NEWLEAD v1] body marker, and it bails if the lead
 * already carries ANY of our task markers (new-lead / callback / backfill) so a
 * lead never shows two "work this lead" tasks. Safe to call on every sync.
 */
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { eq } from "drizzle-orm";
import { listContactTasks, createContactTask } from "@/integrations/ghl/client";
import { GHL_SALESPERSON_USER_ID } from "@/integrations/ghl/config";
import { clampToWorkWindow } from "@/lib/clock/callback-window";

const MARKER = "[NEWLEAD v1]";
// If the lead already has any of these, it's already on the board — don't add.
const COVERED_MARKERS = ["[NEWLEAD v1]", "[CALLBACK v1]", "[BACKFILL v1]"];
const HEBREW = /[֐-׿]/;

// Brand-new lead (still in / just entered the questionnaire, stage NULL) — Eli
// wants the salesperson watching from minute one, not only once the bot finishes
// (2026-07-08). Falls back to this title for any not-yet-classified new lead.
const NEW_LEAD_TITLE = "📞 ליד חדש נכנס — לדבר עם הלקוח";
const STAGE_TITLE: Record<string, string> = {
  INTAKE: "📞 ליד חדש — הצעה נשלחה, להתקשר",
  FACTORY_WAIT: "📞 מפרט מיוחד — להתקשר ולתמחר",
};
const STAGE_HE: Record<string, string> = {
  INTAKE: "שאלון + הצעה",
  FACTORY_WAIT: "בדיקת מפעל",
};

export async function ensureNewLeadTask(
  sid: string,
  contactId: string,
): Promise<void> {
  try {
    if (!contactId) return;
    const [lead] = await db
      .select({
        stage: leads.pipelineStage,
        summary: leads.botSummary,
      })
      .from(leads)
      .where(eq(leads.manychatSubId, sid));
    const stage = lead?.stage;
    // Fire for brand-new leads (stage NULL = still in the questionnaire) as well
    // as INTAKE / FACTORY_WAIT. Skip only leads already worked past intake
    // (DISCAVERY / CONSIDERATION) or closed (WON / LOST) or parked side-stages —
    // those either already carry a task or shouldn't get a "new lead" one.
    const NEW_OR_INTAKE = new Set([null, undefined, "", "INTAKE", "FACTORY_WAIT"]);
    if (!NEW_OR_INTAKE.has(stage as string | null)) return;

    const existing = await listContactTasks(contactId);
    if (
      existing.some((t) =>
        COVERED_MARKERS.some((m) => (t.body ?? "").includes(m)),
      )
    ) {
      return; // already on the salesperson's board
    }

    const due = await clampToWorkWindow(new Date()); // immediate / next work slot
    const title = STAGE_TITLE[stage as string] ?? NEW_LEAD_TITLE;
    const heStage = STAGE_HE[stage as string] ?? "ליד חדש (בשאלון)";
    const lines = [`${MARKER} sid=${sid}`, `שלב: ${heStage}`];
    if (lead?.summary && HEBREW.test(lead.summary)) {
      lines.push(`סיכום: ${lead.summary}`);
    }
    await createContactTask(contactId, {
      title,
      body: lines.join("\n"),
      dueDate: due.toISOString(),
      assignedTo: GHL_SALESPERSON_USER_ID || undefined,
    });
  } catch (e) {
    console.warn(
      "[new-lead-task] failed",
      sid,
      e instanceof Error ? e.message : String(e),
    );
  }
}
