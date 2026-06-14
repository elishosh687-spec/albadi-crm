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
    if (stage !== "INTAKE" && stage !== "FACTORY_WAIT") return;

    const existing = await listContactTasks(contactId);
    if (
      existing.some((t) =>
        COVERED_MARKERS.some((m) => (t.body ?? "").includes(m)),
      )
    ) {
      return; // already on the salesperson's board
    }

    const due = await clampToWorkWindow(new Date()); // immediate / next work slot
    const lines = [`${MARKER} sid=${sid}`, `שלב: ${STAGE_HE[stage]}`];
    if (lead?.summary && HEBREW.test(lead.summary)) {
      lines.push(`סיכום: ${lead.summary}`);
    }
    await createContactTask(contactId, {
      title: STAGE_TITLE[stage],
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
