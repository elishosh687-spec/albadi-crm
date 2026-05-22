// GoHighLevel sync orchestrator.
//
// Public API (fire-and-forget — all errors swallowed + console.error'd):
//   - upsertGHLContact(lead)            → ensure contact exists, cache id in DB
//   - createOrUpdateGHLOpportunity(lead) → ensure opportunity, move to right stage
//   - syncLeadToGHL(sid)                → load lead → upsert contact + opportunity
//   - forwardMessage({sid, direction, sender, text}) → mirror chat to GHL timeline
//
// All public methods short-circuit if ENABLE_GHL_SYNC=0.

import { db } from "@/lib/db";
import { leads, crmTasks } from "@/drizzle/schema";
import { eq, sql } from "drizzle-orm";
import {
  ENABLE_GHL_SYNC,
  GHL_CONVERSATION_PROVIDER_ID,
  GHL_PIPELINE_ID,
  requireGHLLocationId,
} from "./config";
import {
  upsertContact,
  createOpportunity,
  updateOpportunity,
  postInboundMessage,
  postOutboundMessage,
  addContactNote,
  uploadMediaFromUrl,
  createContactTask,
  updateContactTask,
  type GHLContact,
  type GHLOpportunity,
} from "./client";
import { auditMirror } from "./audit";
import { getValidAccessToken } from "./oauth";
import {
  buildCustomFieldsPayload,
  buildLeadDisplayName,
  pickOpportunityStatus,
  pickStageId,
  type LocalLeadSnapshot,
} from "./mapping";

// Map MIME type → preferred extension. Drives both `guessFilenameFromMime`
// and the URL path we proxy through `/api/integrations/media/<x>.<ext>`
// so GHL's /medias/upload-file accepts the source (it whitelists by path
// extension and rejects `.oga`, generic urls, etc.).
function extFromMime(mime: string | null | undefined): string {
  if (!mime) return "bin";
  const lower = mime.toLowerCase();
  if (lower.startsWith("audio/ogg")) return "ogg";
  if (lower.startsWith("audio/mpeg")) return "mp3";
  if (lower.startsWith("audio/mp4")) return "m4a";
  if (lower.startsWith("audio/")) return "ogg";
  if (lower.startsWith("image/jpeg")) return "jpg";
  if (lower.startsWith("image/png")) return "png";
  if (lower.startsWith("image/webp")) return "webp";
  if (lower.startsWith("image/")) return "jpg";
  if (lower.startsWith("video/mp4")) return "mp4";
  if (lower.startsWith("video/")) return "mp4";
  if (lower === "application/pdf") return "pdf";
  return "bin";
}

function guessFilenameFromMime(mime: string | null | undefined): string {
  return `file.${extFromMime(mime)}`;
}

function base64Url(s: string): string {
  return Buffer.from(s, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function buildProxyUrl(srcUrl: string, mime: string | null | undefined): string {
  // MUST use VERCEL_PROJECT_PRODUCTION_URL, not VERCEL_URL — the latter is
  // the per-deployment preview alias (e.g. albadi-xxxx-elishosh687-…vercel.app)
  // which Vercel SSO-gates and external services (GHL Inbox) cannot fetch.
  // Result was broken image / silent audio in the GHL UI even though the
  // mirror call itself succeeded. See CHANGELOG entry on the same gotcha
  // for Server Actions.
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    "https://albadi-crm.vercel.app";
  const origin = base.startsWith("http") ? base : `https://${base}`;
  const ext = extFromMime(mime);
  return `${origin}/api/integrations/media/${base64Url(srcUrl)}.${ext}`;
}

// ===========================================================================
// Internal: lead loader
// ===========================================================================

interface LoadedLead extends LocalLeadSnapshot {
  ghlContactId: string | null;
  ghlOpportunityId: string | null;
}

async function loadLead(sid: string): Promise<LoadedLead | null> {
  // Only load columns mapping.ts actually uses + GHL id cache columns.
  // Calculator iframe reads full lead state directly from DB on its own.
  const [row] = await db
    .select({
      manychatSubId: leads.manychatSubId,
      name: leads.name,
      phoneE164: leads.phoneE164,
      waJid: leads.waJid,
      pipelineStage: leads.pipelineStage,
      pipelineFlag: leads.pipelineFlag,
      botSummary: leads.botSummary,
      quoteTotal: leads.quoteTotal,
      lossReason: leads.lossReason,
      botPaused: leads.botPaused,
      followUpDate: leads.followUpDate,
      followUpCount: leads.followUpCount,
      nextAction: leads.nextAction,
      ghlContactId: leads.ghlContactId,
      ghlOpportunityId: leads.ghlOpportunityId,
    })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${sid.trim()}`)
    .limit(1);
  return row ?? null;
}

async function cacheContactId(sid: string, contactId: string): Promise<void> {
  await db
    .update(leads)
    .set({ ghlContactId: contactId, updatedAt: new Date() })
    .where(eq(leads.manychatSubId, sid));
}

async function cacheOpportunityId(
  sid: string,
  opportunityId: string
): Promise<void> {
  await db
    .update(leads)
    .set({ ghlOpportunityId: opportunityId, updatedAt: new Date() })
    .where(eq(leads.manychatSubId, sid));
}

// ===========================================================================
// Public: contact upsert
// ===========================================================================

/**
 * Look up or create a GHL contact for this lead, by phone (E.164).
 *
 * Caches `ghl_contact_id` on the leads row for fast subsequent lookups.
 * If the DB already has a cached id, we still patch the contact with the
 * latest custom fields (so GHL stays in sync after questionnaire updates).
 *
 * @returns the GHL contact id, or null on failure / sync disabled.
 */
export async function upsertGHLContact(
  lead: LoadedLead | LocalLeadSnapshot
): Promise<string | null> {
  if (!ENABLE_GHL_SYNC) return null;
  if (!lead.phoneE164 && !lead.waJid) return null;

  try {
    const customFields = buildCustomFieldsPayload(lead);
    const res = await upsertContact({
      locationId: requireGHLLocationId(),
      name: buildLeadDisplayName(lead),
      phone: lead.phoneE164 ?? undefined,
      source: "whatsapp-bridge",
      customFields,
    });
    const contactId = res.contact.id;
    if ("ghlContactId" in lead && lead.ghlContactId !== contactId) {
      await cacheContactId(lead.manychatSubId, contactId);
    }
    return contactId;
  } catch (err) {
    console.error(
      "[ghl.sync] upsertGHLContact failed",
      lead.manychatSubId,
      err
    );
    return null;
  }
}

// ===========================================================================
// Public: opportunity create/update
// ===========================================================================

/**
 * Place or move a GHL opportunity for this lead in the configured pipeline.
 *
 * - If `ghl_opportunity_id` is cached → PUT to update stage + fields.
 * - Otherwise → POST to create. Caches the new id.
 * - Stage id resolved by lib/ghl/mapping.ts:pickStageId (handles NEEDS_ELI
 *   escalation override).
 *
 * @returns the opportunity id, or null on failure / sync disabled.
 */
export async function createOrUpdateGHLOpportunity(
  lead: LoadedLead,
  contactId: string
): Promise<string | null> {
  if (!ENABLE_GHL_SYNC) return null;
  if (!GHL_PIPELINE_ID) {
    console.warn("[ghl.sync] GHL_PIPELINE_ID not set — skipping opportunity");
    return null;
  }
  const stageId = pickStageId(lead);
  if (!stageId) {
    console.warn(
      "[ghl.sync] no stage id for",
      lead.manychatSubId,
      "stage=",
      lead.pipelineStage,
      "flag=",
      lead.pipelineFlag
    );
    return null;
  }

  const customFields = buildCustomFieldsPayload(lead);
  const status = pickOpportunityStatus(lead);
  const monetary = lead.quoteTotal ? Number(lead.quoteTotal) : undefined;
  const name = buildLeadDisplayName(lead);

  try {
    if (lead.ghlOpportunityId) {
      const updated = await updateOpportunity(lead.ghlOpportunityId, {
        pipelineId: GHL_PIPELINE_ID,
        pipelineStageId: stageId,
        name,
        status,
        monetaryValue: monetary,
        customFields,
      });
      return updated.id;
    }
    const created = await createOpportunity({
      pipelineId: GHL_PIPELINE_ID,
      pipelineStageId: stageId,
      contactId,
      name,
      status,
      monetaryValue: monetary,
      source: "whatsapp-bridge",
      customFields,
    });
    await cacheOpportunityId(lead.manychatSubId, created.id);
    return created.id;
  } catch (err) {
    console.error(
      "[ghl.sync] createOrUpdateGHLOpportunity failed",
      lead.manychatSubId,
      err
    );
    return null;
  }
}

// ===========================================================================
// Public: lead-wide sync (the call site invoked from the webhook + actions)
// ===========================================================================

/**
 * One-shot sync for a single lead. Loads fresh state from DB, upserts the
 * contact, then creates/updates the opportunity.
 *
 * Fire-and-forget from any caller:
 *   void syncLeadToGHL(sid);
 *
 * Never throws. Errors logged and swallowed so the WhatsApp hot path
 * keeps running if GHL is down.
 */
export async function syncLeadToGHL(sid: string): Promise<void> {
  if (!ENABLE_GHL_SYNC) return;
  try {
    const lead = await loadLead(sid);
    if (!lead) return;
    const contactId =
      lead.ghlContactId ?? (await upsertGHLContact(lead));
    if (!contactId) return;
    // Always re-push fields on every sync (cheap; keeps GHL hot).
    if (lead.ghlContactId) {
      await upsertGHLContact(lead);
    }
    await createOrUpdateGHLOpportunity(
      { ...lead, ghlContactId: contactId },
      contactId
    );
    // Reconcile signal-derived tasks + owner tag. Fire-and-forget within
    // the sync — same fail-soft semantics as the rest of this function.
    const { reconcileGHLTasksForLead } = await import(
      "@/lib/ghl-tasks/reconcile"
    );
    void reconcileGHLTasksForLead(sid);
  } catch (err) {
    console.error("[ghl.sync] syncLeadToGHL failed", sid, err);
  }
}

// ===========================================================================
// Public: tasks sync (crm_tasks → GHL Contact Tasks)
// ===========================================================================

/**
 * Push a single crm_tasks row to GHL as a Contact Task. The GHL task id
 * is cached on `crm_tasks.ghl_task_id` so subsequent updates (e.g. mark
 * completed) target the same record instead of creating duplicates.
 *
 * Fire-and-forget — errors logged and swallowed so the dashboard / bot
 * pipeline never blocks on GHL hiccups.
 */
export async function syncTaskToGHL(taskId: number): Promise<void> {
  if (!ENABLE_GHL_SYNC) return;
  try {
    const [task] = await db
      .select({
        id: crmTasks.id,
        sid: crmTasks.manychatSubId,
        title: crmTasks.title,
        status: crmTasks.status,
        dueAt: crmTasks.dueAt,
        ghlTaskId: crmTasks.ghlTaskId,
      })
      .from(crmTasks)
      .where(eq(crmTasks.id, taskId))
      .limit(1);
    if (!task) return;

    // Need the GHL contact id — pull from the lead row.
    const [leadRow] = await db
      .select({ ghlContactId: leads.ghlContactId })
      .from(leads)
      .where(sql`trim(${leads.manychatSubId}) = ${task.sid.trim()}`)
      .limit(1);
    if (!leadRow?.ghlContactId) {
      console.warn("[ghl.sync] syncTaskToGHL skipped — no ghl_contact_id", {
        taskId,
        sid: task.sid,
      });
      return;
    }
    const contactId = leadRow.ghlContactId;

    // GHL requires a dueDate. Fall back to "in 24h" if the task didn't
    // carry one (the dashboard sometimes creates open-ended reminders).
    const dueIso = (task.dueAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000))
      .toISOString();
    const completed = task.status === "completed";

    if (!task.ghlTaskId) {
      // First push — create.
      const created = await createContactTask(contactId, {
        title: task.title,
        dueDate: dueIso,
        completed,
      });
      await db
        .update(crmTasks)
        .set({ ghlTaskId: created.id, updatedAt: new Date() })
        .where(eq(crmTasks.id, taskId));
      return;
    }

    // Already in GHL — patch.
    await updateContactTask(contactId, task.ghlTaskId, {
      title: task.title,
      dueDate: dueIso,
      completed,
    });
  } catch (err) {
    console.error("[ghl.sync] syncTaskToGHL failed", taskId, err);
  }
}

// ===========================================================================
// Public: mirror chat messages to GHL conversation timeline
// ===========================================================================

/**
 * Mirror an inbound or outbound message into GHL's conversation timeline
 * for the lead's contact. Falls back to addContactNote if the messages
 * endpoint rejects (e.g. no custom channel registered yet).
 */
export async function forwardMessage(opts: {
  sid: string;
  direction: "in" | "out";
  sender: "lead" | "bot" | "eli";
  text: string | null;
  occurredAt: Date;
  // Optional public media URL (e.g. GreenAPI downloadUrl for image/audio/video/doc).
  // When set, the helper uploads to GHL /medias/upload-file with the correct
  // mime so the Inbox renders the file inline (audio plays, image shows),
  // not as a generic document attachment.
  mediaUrl?: string | null;
  mediaFilename?: string | null;
  mediaMimeType?: string | null;
}): Promise<void> {
  // TEMP audit (issue: business-side WA sends not appearing in GHL Inbox).
  // Emits ghl_mirror.* rows to bridge_events so we can read where the
  // mirror silently dies. Remove once the underlying bug is closed.
  await auditMirror("attempt", opts.sid, {
    direction: opts.direction,
    sender: opts.sender,
    textPreview: (opts.text ?? "").slice(0, 100),
    textLen: opts.text?.length ?? 0,
    hasMedia: !!opts.mediaUrl,
    enableFlag: ENABLE_GHL_SYNC,
  });

  if (!ENABLE_GHL_SYNC) {
    await auditMirror("skip", opts.sid, { reason: "no_enable_flag" });
    return;
  }
  // Allow empty text when media is present (audio messages have no caption).
  if (!opts.text?.trim() && !opts.mediaUrl) {
    await auditMirror("skip", opts.sid, { reason: "empty_payload" });
    return;
  }

  try {
    const lead = await loadLead(opts.sid);
    if (!lead) {
      await auditMirror("skip", opts.sid, { reason: "no_lead" });
      return;
    }
    const contactId =
      lead.ghlContactId ?? (await upsertGHLContact(lead));
    if (!contactId) {
      await auditMirror("skip", opts.sid, {
        reason: "no_contact",
        leadHadGhlContactId: !!lead.ghlContactId,
      });
      return;
    }

    const labelMap = {
      lead: "📥 לקוח",
      bot: "🤖 בוט",
      eli: "📤 אלי",
    } as const;
    const label = labelMap[opts.sender];
    const caption = opts.text?.trim();
    const body = caption ? `${label}\n${caption}` : label;

    // Resolve attachments. For media we upload the source to GHL so the
    // Inbox renders it with correct content-type (otherwise GreenAPI URLs
    // come without extension and GHL treats audio as a generic file).
    let attachments: string[] | undefined;
    if (opts.mediaUrl) {
      // Route through our media proxy so the URL path carries the right
      // extension (.ogg/.mp4/.jpg). GHL rejects `.oga` from GreenAPI and
      // generic URLs, but accepts the proxied URL because the extension
      // matches its whitelist.
      const proxyUrl = buildProxyUrl(opts.mediaUrl, opts.mediaMimeType);
      const tokenForUpload =
        (await getValidAccessToken(requireGHLLocationId())) ?? null;
      if (tokenForUpload) {
        try {
          const uploaded = await uploadMediaFromUrl({
            url: proxyUrl,
            filename: opts.mediaFilename || guessFilenameFromMime(opts.mediaMimeType),
            mimeType: opts.mediaMimeType ?? undefined,
            accessToken: tokenForUpload,
          });
          attachments = [uploaded.url];
        } catch (uploadErr) {
          console.warn(
            "[ghl.sync] media upload failed, falling back to proxy url",
            uploadErr
          );
          attachments = [proxyUrl];
        }
      } else {
        attachments = [proxyUrl];
      }
    }

    // Route through our Custom Conversation Provider when configured so
    // inbound + outbound land in the same thread tagged "Albadi WhatsApp".
    // Falls back to SMS type when providerId is missing (pre-1F sessions).
    const type = GHL_CONVERSATION_PROVIDER_ID ? "Custom" : "SMS";
    const conversationProviderId = GHL_CONVERSATION_PROVIDER_ID || undefined;
    // CUSTOM provider endpoints require OAuth (PIT lacks provider access).
    const accessToken = conversationProviderId
      ? (await getValidAccessToken(requireGHLLocationId())) ?? undefined
      : undefined;
    try {
      const result =
        opts.direction === "in"
          ? await postInboundMessage({
              contactId,
              message: body,
              type,
              conversationProviderId,
              accessToken,
              attachments,
            })
          : await postOutboundMessage({
              contactId,
              message: body,
              type,
              conversationProviderId,
              accessToken,
              attachments,
            });
      await auditMirror("success", opts.sid, {
        contactId,
        type,
        hasAccessToken: !!accessToken,
        providerId: conversationProviderId ?? null,
        messageId: result?.messageId ?? null,
        conversationId: result?.conversationId ?? null,
      });
    } catch (msgErr) {
      // Fallback: note. Conversations API requires a registered provider
      // for non-SMS channels; until then notes always work.
      const e = msgErr as
        | (Error & { status?: number; responseBody?: string; ghlPath?: string })
        | unknown;
      const errInfo = {
        contactId,
        type,
        hasAccessToken: !!accessToken,
        providerId: conversationProviderId ?? null,
        endpoint: (e as { ghlPath?: string })?.ghlPath ?? null,
        status: (e as { status?: number })?.status ?? null,
        body: ((e as { responseBody?: string })?.responseBody ?? "").slice(
          0,
          500
        ),
        message:
          msgErr instanceof Error ? msgErr.message : String(msgErr),
      };
      console.warn(
        "[ghl.sync] message endpoint failed, falling back to note",
        msgErr
      );
      try {
        const note = await addContactNote(contactId, body);
        await auditMirror("fallback_note", opts.sid, {
          ...errInfo,
          noteId: (note as { id?: string })?.id ?? null,
        });
      } catch (noteErr) {
        await auditMirror("fail", opts.sid, {
          ...errInfo,
          stage: "addContactNote",
          noteError:
            noteErr instanceof Error ? noteErr.message : String(noteErr),
        });
      }
    }
  } catch (err) {
    console.error("[ghl.sync] forwardMessage failed", opts.sid, err);
    const e = err as
      | (Error & { status?: number; responseBody?: string; ghlPath?: string; stack?: string })
      | unknown;
    await auditMirror("fail", opts.sid, {
      stage: "outer",
      endpoint: (e as { ghlPath?: string })?.ghlPath ?? null,
      status: (e as { status?: number })?.status ?? null,
      body: ((e as { responseBody?: string })?.responseBody ?? "").slice(
        0,
        500
      ),
      message: err instanceof Error ? err.message : String(err),
      stack: (e as { stack?: string })?.stack?.slice(0, 1000) ?? null,
    });
  }
}

// ===========================================================================
// Public: lightweight event note (stage transitions, supervisor verdicts)
// ===========================================================================

export async function forwardEvent(opts: {
  sid: string;
  kind: string;
  detail: string;
}): Promise<void> {
  if (!ENABLE_GHL_SYNC) return;
  try {
    const lead = await loadLead(opts.sid);
    if (!lead) return;
    const contactId =
      lead.ghlContactId ?? (await upsertGHLContact(lead));
    if (!contactId) return;
    await addContactNote(contactId, `[${opts.kind}] ${opts.detail}`);
  } catch (err) {
    console.error("[ghl.sync] forwardEvent failed", opts.sid, err);
  }
}
