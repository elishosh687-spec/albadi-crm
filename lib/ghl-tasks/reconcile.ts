/**
 * Reconcile GHL Contact Tasks for a single lead — diff the desired task set
 * (computed by deriveDesiredTasks) against the cached set in
 * `ghl_lead_tasks` and issue create/update/delete calls accordingly. Also
 * toggles the bot_active / eli_action ownership tag.
 *
 * Fire-and-forget — every caller wraps in `void reconcileGHLTasksForLead(...)`
 * so a GHL hiccup never blocks the WhatsApp / dashboard hot path.
 */

import { db } from "@/lib/db";
import {
  leads,
  botDrafts,
  factoryQuoteRequests,
  ghlLeadTasks,
  leadTags,
} from "@/drizzle/schema";
import { and, eq, sql } from "drizzle-orm";
import { ENABLE_GHL_SYNC } from "@/integrations/ghl/config";
import {
  createContactTask,
  updateContactTask,
  deleteContactTask,
  addContactTags,
  removeContactTags,
} from "@/integrations/ghl/client";
import {
  deriveDesiredTasks,
  type DesiredTask,
  type LeadSignalSnapshot,
  type SignalKind,
} from "./derive";

const OWNER_TAG_BOT = "bot_active";
const OWNER_TAG_ELI = "eli_action";

async function loadSnapshot(sid: string): Promise<{
  ghlContactId: string;
  snapshot: LeadSignalSnapshot;
} | null> {
  const [lead] = await db
    .select({
      sid: leads.manychatSubId,
      ghlContactId: leads.ghlContactId,
      pipelineStage: leads.pipelineStage,
      pipelineFlag: leads.pipelineFlag,
      botPaused: leads.botPaused,
      quoteTotal: leads.quoteTotal,
      lastResponseAt: leads.lastResponseAt,
      updatedAt: leads.updatedAt,
      qState: leads.qState,
    })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${sid.trim()}`)
    .limit(1);
  if (!lead || !lead.ghlContactId) return null;

  // Pending drafts
  const draftRows = await db
    .select({ generatedAt: botDrafts.generatedAt })
    .from(botDrafts)
    .where(
      and(
        sql`trim(${botDrafts.manychatSubId}) = ${sid.trim()}`,
        eq(botDrafts.status, "pending")
      )
    );
  const pendingDraftEarliest = draftRows
    .map((d) => d.generatedAt)
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

  // Factory received
  const factoryRows = await db
    .select({ id: factoryQuoteRequests.id })
    .from(factoryQuoteRequests)
    .where(
      and(
        sql`trim(${factoryQuoteRequests.manychatSubId}) = ${sid.trim()}`,
        eq(factoryQuoteRequests.factoryStatus, "received")
      )
    );

  return {
    ghlContactId: lead.ghlContactId,
    snapshot: {
      sid: lead.sid,
      pipelineStage: lead.pipelineStage,
      pipelineFlag: lead.pipelineFlag,
      botPaused: lead.botPaused,
      quoteTotal: lead.quoteTotal,
      lastResponseAt: lead.lastResponseAt,
      updatedAt: lead.updatedAt,
      qState: (lead.qState as Record<string, unknown> | null) ?? null,
      pendingDraftCount: draftRows.length,
      pendingDraftEarliest,
      factoryReceivedCount: factoryRows.length,
    },
  };
}

async function loadCached(sid: string): Promise<Map<SignalKind, {
  id: number;
  ghlTaskId: string;
  title: string | null;
  dueAt: Date | null;
}>> {
  const rows = await db
    .select({
      id: ghlLeadTasks.id,
      signalKind: ghlLeadTasks.signalKind,
      ghlTaskId: ghlLeadTasks.ghlTaskId,
      title: ghlLeadTasks.title,
      dueAt: ghlLeadTasks.dueAt,
    })
    .from(ghlLeadTasks)
    .where(sql`trim(${ghlLeadTasks.leadSid}) = ${sid.trim()}`);
  const m = new Map<SignalKind, {
    id: number;
    ghlTaskId: string;
    title: string | null;
    dueAt: Date | null;
  }>();
  for (const r of rows) {
    m.set(r.signalKind as SignalKind, {
      id: r.id,
      ghlTaskId: r.ghlTaskId,
      title: r.title,
      dueAt: r.dueAt,
    });
  }
  return m;
}

function tasksDiffer(
  desired: DesiredTask,
  cached: { title: string | null; dueAt: Date | null }
): boolean {
  if (desired.title !== cached.title) return true;
  const cachedTime = cached.dueAt?.getTime() ?? null;
  const desiredTime = desired.dueAt.getTime();
  // Allow 1-minute slop so we don't churn on near-identical dueAt rebuilds.
  if (cachedTime === null) return true;
  return Math.abs(cachedTime - desiredTime) > 60_000;
}

export interface ReconcileResult {
  created: number;
  updated: number;
  deleted: number;
  ownerTag: "bot_active" | "eli_action" | null;
}

export async function reconcileGHLTasksForLead(
  sid: string
): Promise<ReconcileResult | null> {
  if (!ENABLE_GHL_SYNC) return null;
  try {
    const loaded = await loadSnapshot(sid);
    if (!loaded) return null;
    const { ghlContactId, snapshot } = loaded;

    const desiredList = deriveDesiredTasks(snapshot);
    const cached = await loadCached(sid);
    const desiredByKind = new Map<SignalKind, DesiredTask>();
    for (const d of desiredList) desiredByKind.set(d.signalKind, d);

    let created = 0;
    let updated = 0;
    let deleted = 0;

    // CREATE / UPDATE
    for (const desired of desiredList) {
      const cur = cached.get(desired.signalKind);
      if (!cur) {
        const newTask = await createContactTask(ghlContactId, {
          title: desired.title,
          dueDate: desired.dueAt.toISOString(),
        });
        await db.insert(ghlLeadTasks).values({
          leadSid: snapshot.sid,
          signalKind: desired.signalKind,
          ghlTaskId: newTask.id,
          title: desired.title,
          dueAt: desired.dueAt,
          completed: false,
        });
        created++;
      } else if (tasksDiffer(desired, cur)) {
        await updateContactTask(ghlContactId, cur.ghlTaskId, {
          title: desired.title,
          dueDate: desired.dueAt.toISOString(),
        });
        await db
          .update(ghlLeadTasks)
          .set({
            title: desired.title,
            dueAt: desired.dueAt,
            lastPushedAt: new Date(),
          })
          .where(eq(ghlLeadTasks.id, cur.id));
        updated++;
      }
    }

    // DELETE — cached rows whose signalKind no longer in desired set.
    for (const [kind, cur] of cached.entries()) {
      if (desiredByKind.has(kind)) continue;
      try {
        await deleteContactTask(ghlContactId, cur.ghlTaskId);
      } catch (e) {
        console.warn(
          "[ghl-tasks] deleteContactTask failed (continuing)",
          cur.ghlTaskId,
          e
        );
      }
      await db.delete(ghlLeadTasks).where(eq(ghlLeadTasks.id, cur.id));
      deleted++;
    }

    // Owner tag toggle
    const eliMustAct = desiredList.length > 0;
    const ownerTag = eliMustAct ? OWNER_TAG_ELI : OWNER_TAG_BOT;
    const otherTag = eliMustAct ? OWNER_TAG_BOT : OWNER_TAG_ELI;
    try {
      await addContactTags(ghlContactId, [ownerTag]);
      await removeContactTags(ghlContactId, [otherTag]);
      // Mirror to local lead_tags so DB-side filters stay in sync.
      await mirrorLeadTag(snapshot.sid, ownerTag, otherTag);
    } catch (e) {
      console.warn("[ghl-tasks] owner tag toggle failed", sid, e);
    }

    return {
      created,
      updated,
      deleted,
      ownerTag: ownerTag as "bot_active" | "eli_action",
    };
  } catch (err) {
    console.error("[ghl-tasks] reconcile failed", sid, err);
    return null;
  }
}

async function mirrorLeadTag(
  sid: string,
  addTagName: string,
  removeTagName: string
): Promise<void> {
  const cleanSid = sid.trim();
  // Insert if not present.
  const existing = await db
    .select({ id: leadTags.id })
    .from(leadTags)
    .where(
      and(
        sql`trim(${leadTags.manychatSubId}) = ${cleanSid}`,
        eq(leadTags.tag, addTagName)
      )
    )
    .limit(1);
  if (existing.length === 0) {
    await db
      .insert(leadTags)
      .values({ manychatSubId: cleanSid, tag: addTagName });
  }
  await db
    .delete(leadTags)
    .where(
      and(
        sql`trim(${leadTags.manychatSubId}) = ${cleanSid}`,
        eq(leadTags.tag, removeTagName)
      )
    );
}
