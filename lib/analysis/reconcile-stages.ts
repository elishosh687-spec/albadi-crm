/**
 * GHL → DB pipeline-stage reconcile. GHL is the source of truth for
 * pipeline_stage; the DB mirror drifts (the "Opportunity Stage Changed" GHL
 * workflow fires on CHANGE, not on opp CREATION, so a lead whose opp is created
 * directly in a side stage never syncs). This pulls every opportunity's real
 * stage from GHL and corrects the DB, so anything that reads the DB (the audit,
 * the inbox) reflects GHL.
 *
 * Rule: GHL wins, FULL STOP (Eli 2026-07-16 — "GHL הוא האמת, הכל נמשך משם";
 * he explicitly approved syncing even the LOST↔active conflicts). Best-effort:
 * any GHL failure returns ok:false and the caller proceeds with the DB as-is.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { GHL_STAGE_IDS, GHL_PIPELINE_ID } from "@/integrations/ghl/config";
import { listAllPipelineOpportunities } from "@/integrations/ghl/client";

export interface StageReconcileResult {
  ok: boolean;
  reason?: string;
  checked: number;
  updated: { sid: string; from: string; to: string }[];
  keptLost: number;
}

// GHL stage UUID → local pipeline_stage enum. Excludes NEEDS_ELI (virtual —
// lives on pipeline_flag, never on pipeline_stage).
function buildReverseMap(): Map<string, string> {
  const m = new Map<string, string>();
  for (const [local, id] of Object.entries(GHL_STAGE_IDS)) {
    if (!id || local === "NEEDS_ELI") continue;
    m.set(id, local);
  }
  return m;
}

export async function reconcileStagesFromGhl(): Promise<StageReconcileResult> {
  const base = { checked: 0, updated: [] as { sid: string; from: string; to: string }[], keptLost: 0 };
  if (!GHL_PIPELINE_ID) return { ok: false, reason: "no_pipeline_id", ...base };
  const reverse = buildReverseMap();
  if (reverse.size === 0) return { ok: false, reason: "no_stage_ids", ...base };

  let opps;
  try {
    opps = await listAllPipelineOpportunities(GHL_PIPELINE_ID);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e), ...base };
  }

  // Opportunity STATUS overrides the stage COLUMN: GHL lets you mark an opp
  // won/lost via status without dragging it out of its stage column (e.g. an
  // opp still in "משא ומתן" but status=lost). Honour status first — else a
  // lost lead keeps looking active and shows in "נפלו בין הכיסאות".
  // (Found 2026-07-16 via עידן: column=CONSIDERATION, status=lost.)
  const oppToLocal = (o: (typeof opps)[number]): string | undefined => {
    if (o.status === "won") return "WON";
    if (o.status === "lost") return "LOST";
    return o.pipelineStageId ? reverse.get(o.pipelineStageId) : undefined;
  };

  // Two indexes: by OPPORTUNITY id (precise — the deal the lead is linked to)
  // and by CONTACT id (fallback, last-opp-wins). A contact can hold BOTH a lost
  // deal AND a stray open duplicate; keying by the lead's own ghl_opportunity_id
  // picks the RIGHT one instead of letting the open duplicate win and keep a
  // lost lead "active" (Eli 2026-07-23: 3 lost leads stuck in "בין הכיסאות").
  const byOpp = new Map<string, string>();
  const byContact = new Map<string, string>();
  for (const o of opps) {
    const local = oppToLocal(o);
    if (!local) continue;
    if (o.id) byOpp.set(o.id, local);
    if (o.contactId) byContact.set(o.contactId, local);
  }

  const active = await db
    .select({ sid: leads.manychatSubId, stage: leads.pipelineStage, ghl: leads.ghlContactId, opp: leads.ghlOpportunityId })
    .from(leads)
    .where(eq(leads.active, true));

  const updated: { sid: string; from: string; to: string }[] = [];
  const keptLost = 0;
  let checked = 0;
  for (const l of active) {
    // Prefer the lead's OWN linked opportunity; fall back to contact-level
    // (last-wins) only when the linked opp isn't in the scanned pipeline.
    const to = (l.opp && byOpp.get(l.opp)) || (l.ghl && byContact.get(l.ghl)) || undefined;
    if (!to) continue;
    checked++;
    const from = l.stage ?? "NULL";
    if (from === to) continue;
    // GHL wins unconditionally — including LOST↔active (Eli approved 2026-07-16).
    await db
      .update(leads)
      .set({ pipelineStage: to, updatedAt: new Date() })
      .where(eq(leads.manychatSubId, l.sid));
    updated.push({ sid: l.sid, from, to });
  }
  return { ok: true, checked, updated, keptLost };
}
