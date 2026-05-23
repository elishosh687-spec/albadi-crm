/**
 * Core GHL → DB resync logic. Shared by:
 *   - /api/ghl/resync         (legacy: triggered by GHL Workflow webhooks)
 *   - /api/ghl/app-webhook    (new: triggered by GHL Marketplace App native webhooks)
 *
 * Pulls a fresh contact + notes + tasks + opportunities from GHL and merges
 * into DB. Idempotent.
 */
import { db } from "@/lib/db";
import {
  leads,
  leadTags,
  crmTasks,
  opportunities,
  leadEvents,
  ghlLeadTasks,
} from "@/drizzle/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  getContact,
  listContactNotes,
  listContactTasks,
  listOpportunitiesForContact,
} from "@/integrations/ghl/client";
import { GHL_FIELD_IDS, GHL_STAGE_IDS } from "@/integrations/ghl/config";

export interface ResyncResult {
  ok: true;
  sid: string;
  contactId: string;
  updated: {
    stage: string | null;
    flag: string | null;
    tagsAdded: string[];
    tagsRemoved: string[];
    tasksUpserted: number;
    staleCacheRemoved: number;
    notesCount: number;
  };
}

export type ResyncError =
  | { ok: false; error: "ghl_fetch_failed"; detail: string }
  | { ok: false; error: "no_lead_matched"; contactId: string };

function reverseLookupStage(stageId: string): string | null {
  for (const [localStage, ghlId] of Object.entries(GHL_STAGE_IDS)) {
    if (ghlId && ghlId === stageId) return localStage;
  }
  return null;
}

function fieldKeyForId(ghlFieldId: string): string | null {
  for (const [key, id] of Object.entries(GHL_FIELD_IDS)) {
    if (id === ghlFieldId) return key;
  }
  return null;
}

export async function resyncContact(
  contactId: string,
  actor: string = "ghl_workflow"
): Promise<ResyncResult | ResyncError> {
  let contact, notes, ghlTasks, opps;
  try {
    [contact, notes, ghlTasks, opps] = await Promise.all([
      getContact(contactId),
      listContactNotes(contactId).catch(() => []),
      listContactTasks(contactId).catch(() => []),
      listOpportunitiesForContact(contactId).catch(() => []),
    ]);
  } catch (e) {
    return { ok: false, error: "ghl_fetch_failed", detail: e instanceof Error ? e.message : String(e) };
  }

  const phoneNorm = contact.phone?.replace(/^\+/, "") ?? "";
  const matchClause = phoneNorm
    ? sql`${leads.ghlContactId} = ${contactId} OR ${leads.phoneE164} = ${phoneNorm}`
    : eq(leads.ghlContactId, contactId);

  const existing = await db.select({ sid: leads.manychatSubId }).from(leads).where(matchClause);
  if (existing.length === 0) {
    return { ok: false, error: "no_lead_matched", contactId };
  }
  const sid = existing[0].sid;

  const cf: Record<string, unknown> = {};
  for (const f of contact.customFields ?? []) {
    const key = fieldKeyForId(f.id);
    if (key) cf[key] = f.value;
  }

  const pipelineId = process.env.GHL_PIPELINE_ID;
  const opp = pipelineId
    ? opps.find((o) => o.pipelineId === pipelineId) ?? opps[0] ?? null
    : opps[0] ?? null;

  let localStage: string | null = null;
  let pipelineFlag: string | null = null;
  if (opp) {
    const mapped = reverseLookupStage(opp.pipelineStageId);
    if (mapped === "NEEDS_ELI") pipelineFlag = "NEEDS_ELI";
    else if (mapped) localStage = mapped;
    if (opp.status === "won") localStage = "WON";
    if (opp.status === "lost") localStage = "LOST";
    if (opp.status === "abandoned") pipelineFlag = "ABANDONED";
  }

  const updateSet: Record<string, unknown> = {
    updatedAt: new Date(),
    ghlContactId: contactId,
  };
  const ghlName =
    contact.name ||
    [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() ||
    null;
  if (ghlName) updateSet.name = ghlName;
  if (contact.phone) updateSet.phoneE164 = phoneNorm;
  if (contact.email !== undefined) updateSet.email = contact.email || null;
  if (localStage) updateSet.pipelineStage = localStage;
  if (opp) {
    updateSet.pipelineFlag = pipelineFlag;
    updateSet.ghlOpportunityId = opp.id;
  }
  if (cf.bot_summary !== undefined) updateSet.botSummary = String(cf.bot_summary ?? "") || null;
  if (cf.quote_total !== undefined) {
    const n = cf.quote_total;
    updateSet.quoteTotal = n === null || n === "" ? null : String(n);
  }
  if (cf.loss_reason !== undefined) updateSet.lossReason = String(cf.loss_reason ?? "") || null;
  // bot_paused / lead_owner intentionally NOT mirrored from GHL here (race
  // condition between widget toggle and stale push). Handled by the narrow
  // /api/integrations/inbound/ghl-custom-field webhook instead.
  if (cf.follow_up_date !== undefined) {
    const v = cf.follow_up_date;
    updateSet.followUpDate = v === null || v === "" ? null : String(v);
  }
  if (cf.follow_up_count !== undefined) {
    const v = cf.follow_up_count;
    if (v === null || v === "") updateSet.followUpCount = 0;
    else {
      const n = Number(v);
      if (!Number.isNaN(n)) updateSet.followUpCount = n;
    }
  }
  if (cf.next_action !== undefined) {
    updateSet.nextAction = String(cf.next_action ?? "") || null;
  }
  if (notes.length > 0) {
    const sorted = [...notes].sort((a, b) =>
      (b.dateAdded ?? "").localeCompare(a.dateAdded ?? "")
    );
    updateSet.notes = sorted.map((n) => n.body).join("\n\n---\n\n");
  }

  await db.update(leads).set(updateSet).where(eq(leads.manychatSubId, sid));

  // Tag diff
  const ghlTagSet = new Set((contact.tags ?? []).map((t) => t.trim()).filter(Boolean));
  const dbTagRows = await db
    .select({ tag: leadTags.tag })
    .from(leadTags)
    .where(eq(leadTags.manychatSubId, sid));
  const dbTagSet = new Set(dbTagRows.map((r) => r.tag));
  const toInsert = [...ghlTagSet].filter((t) => !dbTagSet.has(t));
  const toDelete = [...dbTagSet].filter((t) => !ghlTagSet.has(t));
  if (toInsert.length > 0) {
    await db.insert(leadTags).values(toInsert.map((tag) => ({ manychatSubId: sid, tag })));
  }
  if (toDelete.length > 0) {
    await db
      .delete(leadTags)
      .where(and(eq(leadTags.manychatSubId, sid), inArray(leadTags.tag, toDelete)));
  }

  // Tasks upsert
  let tasksUpserted = 0;
  for (const t of ghlTasks) {
    const existingTask = await db
      .select({ id: crmTasks.id })
      .from(crmTasks)
      .where(eq(crmTasks.ghlTaskId, t.id))
      .limit(1);
    const due = t.dueDate ? new Date(t.dueDate) : null;
    const completedAt = t.completed ? new Date() : null;
    const status = t.completed ? "completed" : "open";
    if (existingTask.length === 0) {
      await db.insert(crmTasks).values({
        manychatSubId: sid,
        taskType: "follow_up",
        title: t.title,
        status,
        dueAt: due,
        completedAt,
        ghlTaskId: t.id,
      });
    } else {
      await db
        .update(crmTasks)
        .set({ title: t.title, status, dueAt: due, completedAt, updatedAt: new Date() })
        .where(eq(crmTasks.id, existingTask[0].id));
    }
    tasksUpserted++;
  }

  // Stale signal-task cache pruning
  const liveGhlTaskIds = new Set(ghlTasks.map((t) => t.id));
  const cachedRows = await db
    .select({ id: ghlLeadTasks.id, ghlTaskId: ghlLeadTasks.ghlTaskId })
    .from(ghlLeadTasks)
    .where(sql`trim(${ghlLeadTasks.leadSid}) = ${sid.trim()}`);
  let staleCacheRemoved = 0;
  for (const c of cachedRows) {
    if (!liveGhlTaskIds.has(c.ghlTaskId)) {
      await db.delete(ghlLeadTasks).where(eq(ghlLeadTasks.id, c.id));
      staleCacheRemoved++;
    }
  }

  // Opportunity value sync
  if (opp && typeof opp.monetaryValue === "number") {
    const existingOpp = await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(eq(opportunities.manychatSubId, sid))
      .limit(1);
    const wonAt = opp.status === "won" ? new Date() : null;
    const lostAt = opp.status === "lost" ? new Date() : null;
    if (existingOpp.length === 0) {
      await db.insert(opportunities).values({
        manychatSubId: sid,
        pipelineStage: localStage ?? "open",
        valueIls: opp.monetaryValue,
        wonAt,
        lostAt,
      });
    } else {
      await db
        .update(opportunities)
        .set({
          pipelineStage: localStage ?? undefined,
          valueIls: opp.monetaryValue,
          wonAt: wonAt ?? undefined,
          lostAt: lostAt ?? undefined,
          updatedAt: new Date(),
        })
        .where(eq(opportunities.id, existingOpp[0].id));
    }
  }

  await db.insert(leadEvents).values({
    manychatSubId: sid,
    eventType: "ghl_resync",
    actor,
    payload: {
      contactId,
      opportunityId: opp?.id ?? null,
      stage: localStage,
      flag: pipelineFlag,
      tagsAdded: toInsert,
      tagsRemoved: toDelete,
      tasksUpserted,
      staleCacheRemoved,
      notesCount: notes.length,
    },
  });

  return {
    ok: true,
    sid,
    contactId,
    updated: {
      stage: localStage,
      flag: pipelineFlag,
      tagsAdded: toInsert,
      tagsRemoved: toDelete,
      tasksUpserted,
      staleCacheRemoved,
      notesCount: notes.length,
    },
  };
}

/**
 * Soft-delete a lead in DB when GHL fires ContactDelete.
 * Sets active=false + clears ghlContactId so future webhooks
 * don't try to push to a dead contact.
 */
export async function softDeleteContact(contactId: string): Promise<{ deleted: number }> {
  const result = await db
    .update(leads)
    .set({
      active: false,
      ghlContactId: null,
      ghlOpportunityId: null,
      updatedAt: new Date(),
    })
    .where(eq(leads.ghlContactId, contactId))
    .returning({ sid: leads.manychatSubId });
  for (const r of result) {
    await db.insert(leadEvents).values({
      manychatSubId: r.sid,
      eventType: "lead_deleted",
      actor: "ghl_webhook",
      payload: { contactId, source: "ghl_contact_delete_event" },
    });
  }
  return { deleted: result.length };
}
