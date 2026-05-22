/**
 * POST /api/ghl/resync
 *
 * Full-pull GHL → DB sync for a single contact. Idempotent — called by GHL
 * Workflow webhooks on ANY change (Contact Changed, Opportunity Changed).
 *
 * Auth: Authorization: Bearer <BOT_SECRET>
 *
 * Body: { "contactId": "{{contact.id}}" }
 *   (opportunityId optional — we discover via /opportunities/search regardless)
 *
 * What it does (idempotent merge of GHL → DB):
 *   1. GET /contacts/<id>            → name, phone, email, customFields, tags
 *   2. GET /contacts/<id>/notes      → latest note → leads.notes
 *   3. GET /contacts/<id>/tasks      → upsert into crm_tasks (by ghlTaskId)
 *   4. GET /opportunities/search     → stage, status, monetaryValue
 *      → leads.pipelineStage, leads.pipelineFlag (won/lost), opportunities.valueIls
 *   5. Diff lead_tags → INSERT new, DELETE removed
 *   6. Append lead_events('ghl_resync', { fields_updated: [...] })
 *
 * Fields written from GHL into DB:
 *   leads: name, phoneE164, email, pipelineStage, pipelineFlag, botSummary,
 *          quoteTotal, lossReason, botPaused, notes, ghlOpportunityId
 *   lead_tags: full diff against GHL tags
 *   crm_tasks: title, dueAt, completed (by ghlTaskId match)
 *   opportunities: valueIls, wonAt, lostAt
 *
 * DB-only fields (NOT touched by resync):
 *   qState, quoteAlt, factorySpecDraft, botSummary written by bot logic
 *   (overwritten on next bot run if needed). Per Eli decision 2026-05-22:
 *   GHL is source of truth for ALL shared fields — DB just follows.
 *
 * GHL Workflow setup (configure two workflows, both POST same URL):
 *
 *   Workflow A — "Contact Changed → albadi resync"
 *     Trigger:  Contact Changed (any field)
 *     Action:   Webhook POST
 *       URL:    https://albadi-crm.vercel.app/api/ghl/resync
 *       Header: Authorization: Bearer <BOT_SECRET>
 *               Content-Type: application/json
 *       Body (Custom Data):
 *         contactId = {{contact.id}}
 *
 *   Workflow B — "Opportunity Changed → albadi resync"
 *     Trigger:  Opportunity Status Changed (or Opportunity Changed)
 *     Action:   same as Workflow A
 *
 * The existing dedicated webhooks (ghl-tag, ghl-custom-field, stage-changed)
 * remain for low-latency single-field updates. Resync is the catch-all
 * "anything else" handler + bulk reconciliation.
 */
import { NextRequest, NextResponse } from "next/server";
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

export const runtime = "nodejs";
export const maxDuration = 30;

interface Payload {
  contactId?: string;
  contact_id?: string;
  [key: string]: unknown;
}

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

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get("authorization") || "";
  const secret = process.env.BOT_SECRET || "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rawBody = await req.text();
  console.log("[ghl.resync] raw body", rawBody.slice(0, 400));

  let payload: Payload;
  try {
    payload = JSON.parse(rawBody) as Payload;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const contactId = payload.contactId || payload.contact_id;
  if (!contactId) {
    return NextResponse.json(
      { error: "missing_contactId", received: Object.keys(payload) },
      { status: 400 }
    );
  }

  // --- 1. Pull everything from GHL in parallel ---
  let contact, notes, ghlTasks, opps;
  try {
    [contact, notes, ghlTasks, opps] = await Promise.all([
      getContact(contactId),
      listContactNotes(contactId).catch(() => []),
      listContactTasks(contactId).catch(() => []),
      listOpportunitiesForContact(contactId).catch(() => []),
    ]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[ghl.resync] GHL fetch failed", msg);
    return NextResponse.json({ error: "ghl_fetch_failed", detail: msg }, { status: 502 });
  }

  // --- 2. Match local lead row ---
  const matchClauseArr = [eq(leads.ghlContactId, contactId)];
  if (contact.phone) matchClauseArr.push(eq(leads.phoneE164, contact.phone.replace(/^\+/, "")));
  const existing = await db
    .select({ sid: leads.manychatSubId })
    .from(leads)
    .where(matchClauseArr.length === 1 ? matchClauseArr[0] : sql`${leads.ghlContactId} = ${contactId} OR ${leads.phoneE164} = ${contact.phone?.replace(/^\+/, "") ?? ""}`);

  if (existing.length === 0) {
    console.warn("[ghl.resync] no lead matched", { contactId, phone: contact.phone });
    return NextResponse.json({ error: "no_lead_matched", contactId }, { status: 404 });
  }
  const sid = existing[0].sid;

  // --- 3. Extract custom field values keyed by our internal name ---
  const cf: Record<string, unknown> = {};
  for (const f of contact.customFields ?? []) {
    const key = fieldKeyForId(f.id);
    if (key) cf[key] = f.value;
  }

  // --- 4. Pick latest opportunity in our configured pipeline (if any) ---
  const pipelineId = process.env.GHL_PIPELINE_ID;
  const opp = pipelineId
    ? opps.find((o) => o.pipelineId === pipelineId) ?? opps[0] ?? null
    : opps[0] ?? null;

  let localStage: string | null = null;
  let pipelineFlag: string | null = null;
  if (opp) {
    const mapped = reverseLookupStage(opp.pipelineStageId);
    if (mapped === "NEEDS_ELI") {
      pipelineFlag = "NEEDS_ELI";
    } else if (mapped) {
      localStage = mapped;
    }
    if (opp.status === "won") localStage = "WON";
    if (opp.status === "lost") localStage = "LOST";
    if (opp.status === "abandoned") pipelineFlag = "ABANDONED";
  }

  // --- 5. Build leads update set ---
  const updateSet: Record<string, unknown> = {
    updatedAt: new Date(),
    ghlContactId: contactId,
  };
  // name: GHL combines firstName+lastName, but contact.name is also available
  const ghlName =
    contact.name ||
    [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim() ||
    null;
  if (ghlName) updateSet.name = ghlName;
  if (contact.phone) updateSet.phoneE164 = contact.phone.replace(/^\+/, "");
  if (contact.email !== undefined) updateSet.email = contact.email || null;

  if (localStage) updateSet.pipelineStage = localStage;
  // pipelineFlag: write whatever the opp says (or clear if opp open + not NEEDS_ELI)
  if (opp) {
    updateSet.pipelineFlag = pipelineFlag;
  }
  if (opp) updateSet.ghlOpportunityId = opp.id;

  // Custom fields → DB columns
  if (cf.bot_summary !== undefined) updateSet.botSummary = String(cf.bot_summary ?? "") || null;
  if (cf.quote_total !== undefined) {
    const n = cf.quote_total;
    updateSet.quoteTotal = n === null || n === "" ? null : String(n);
  }
  if (cf.loss_reason !== undefined) updateSet.lossReason = String(cf.loss_reason ?? "") || null;
  if (cf.bot_paused !== undefined) {
    const v = cf.bot_paused;
    updateSet.botPaused = v === "Paused" || v === true || v === "true";
  }
  if (cf.follow_up_date !== undefined) {
    const v = cf.follow_up_date;
    updateSet.followUpDate = v === null || v === "" ? null : String(v);
  }
  if (cf.follow_up_count !== undefined) {
    const v = cf.follow_up_count;
    if (v === null || v === "") {
      updateSet.followUpCount = 0;
    } else {
      const n = Number(v);
      if (!Number.isNaN(n)) updateSet.followUpCount = n;
    }
  }
  if (cf.next_action !== undefined) {
    updateSet.nextAction = String(cf.next_action ?? "") || null;
  }

  // Notes: concat all GHL notes (latest first) into leads.notes
  if (notes.length > 0) {
    const sorted = [...notes].sort((a, b) =>
      (b.dateAdded ?? "").localeCompare(a.dateAdded ?? "")
    );
    updateSet.notes = sorted.map((n) => n.body).join("\n\n---\n\n");
  }

  // --- 6. Write leads row ---
  await db.update(leads).set(updateSet).where(eq(leads.manychatSubId, sid));

  // --- 7. Tag diff: lead_tags ↔ contact.tags ---
  const ghlTagSet = new Set((contact.tags ?? []).map((t) => t.trim()).filter(Boolean));
  const dbTagRows = await db
    .select({ tag: leadTags.tag })
    .from(leadTags)
    .where(eq(leadTags.manychatSubId, sid));
  const dbTagSet = new Set(dbTagRows.map((r) => r.tag));

  const toInsert = [...ghlTagSet].filter((t) => !dbTagSet.has(t));
  const toDelete = [...dbTagSet].filter((t) => !ghlTagSet.has(t));
  if (toInsert.length > 0) {
    await db
      .insert(leadTags)
      .values(toInsert.map((tag) => ({ manychatSubId: sid, tag })));
  }
  if (toDelete.length > 0) {
    await db
      .delete(leadTags)
      .where(and(eq(leadTags.manychatSubId, sid), inArray(leadTags.tag, toDelete)));
  }

  // --- 8. Tasks: upsert into crm_tasks by ghlTaskId ---
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
        .set({
          title: t.title,
          status,
          dueAt: due,
          completedAt,
          updatedAt: new Date(),
        })
        .where(eq(crmTasks.id, existingTask[0].id));
    }
    tasksUpserted++;
  }

  // --- 8b. Clean stale ghl_lead_tasks cache rows ---
  // If a signal-derived task (lib/ghl-tasks/reconcile.ts) was deleted manually
  // in the GHL UI, the cache row stays with a dead ghl_task_id. Next reconciler
  // PUT would 404 and skip recreate. Drop cache rows whose ghl_task_id is no
  // longer present in GHL — reconciler will recreate on next run.
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

  // --- 9. Opportunity value sync ---
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

  // --- 10. Audit ---
  await db.insert(leadEvents).values({
    manychatSubId: sid,
    eventType: "ghl_resync",
    actor: "ghl_workflow",
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

  console.log("[ghl.resync] ok", {
    sid,
    contactId,
    stage: localStage,
    flag: pipelineFlag,
    tagsAdded: toInsert.length,
    tagsRemoved: toDelete.length,
    tasksUpserted,
    staleCacheRemoved,
  });

  return NextResponse.json({
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
  });
}
