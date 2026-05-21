// One-shot backfill: every active lead in DB → GHL contact + opportunity.
// Caches ghl_contact_id + ghl_opportunity_id back on the leads row.
//
// Bypasses ENABLE_GHL_SYNC gate — calls REST client directly. Safe to run
// before flipping the runtime sync flag.
//
// Usage:
//   npx tsx integrations/ghl/backfill.ts                # full run
//   npx tsx integrations/ghl/backfill.ts --dry-run      # plan only, no writes
//   npx tsx integrations/ghl/backfill.ts --resume       # skip ghl_backfilled_at!=null
//   npx tsx integrations/ghl/backfill.ts --extras-only  # only summary/decisions/activity notes (for re-syncing already-contacted leads without duplicating chat/notes)
//   npx tsx integrations/ghl/backfill.ts --chat-to-inbox # replay every message as inbound/outbound SMS in GHL Conversations Inbox (gated by ghl_chat_imported_at)
//   npx tsx integrations/ghl/backfill.ts --sid=<id>     # target single lead
//   npx tsx integrations/ghl/backfill.ts --limit=50     # cap (for smoke test)
//
// Rate limit: GHL allows 10 req/sec per location. We sleep 120ms between
// individual REST calls (contact + opportunity ≈ 240ms per lead → ~4/sec).
//
// Idempotent: contact upsert dedupes by phone server-side. Opportunity create
// is guarded by the cached ghl_opportunity_id we just wrote; on rerun without
// --resume we PUT instead of POST.

import "dotenv/config";
import { db } from "../../lib/db";
import {
  leads,
  messages,
  botDecisionLog,
  leadEvents,
} from "../../drizzle/schema";
import { asc, desc, eq, sql } from "drizzle-orm";
import { GHL_PIPELINE_ID, requireGHLLocationId } from "./config";
import {
  upsertContact,
  createOpportunity,
  updateOpportunity,
  findOpportunityForContact,
  addContactNote,
  postInboundMessage,
  postOutboundMessage,
} from "./client";
import {
  buildCustomFieldsPayload,
  buildLeadDisplayName,
  pickOpportunityStatus,
  pickStageId,
  type LocalLeadSnapshot,
} from "./mapping";

interface Args {
  dryRun: boolean;
  resume: boolean;
  extrasOnly: boolean;
  chatToInbox: boolean;
  limit: number | null;
  sid: string | null;
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let limit: number | null = null;
  let sid: string | null = null;
  for (const a of argv) {
    const ml = a.match(/^--limit=(\d+)$/);
    if (ml) limit = Number(ml[1]);
    const ms = a.match(/^--sid=(.+)$/);
    if (ms) sid = ms[1];
  }
  return {
    dryRun: argv.includes("--dry-run"),
    resume: argv.includes("--resume"),
    extrasOnly: argv.includes("--extras-only"),
    chatToInbox: argv.includes("--chat-to-inbox"),
    limit,
    sid,
  };
}

const RATE_DELAY_MS = 120;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface LeadRow extends LocalLeadSnapshot {
  ghlContactId: string | null;
  ghlOpportunityId: string | null;
  ghlBackfilledAt: Date | null;
  ghlChatImportedAt: Date | null;
  notes: string | null;
  quoteAlt: string | null;
  leadSource: string | null;
  source: string | null;
  followUpDate: string | null;
  qState: unknown;
  factorySpecDraft: unknown;
}

async function loadLeads(args: Args): Promise<LeadRow[]> {
  const rows = await db
    .select({
      manychatSubId: leads.manychatSubId,
      name: leads.name,
      phoneE164: leads.phoneE164,
      waJid: leads.waJid,
      pipelineStage: leads.pipelineStage,
      pipelineFlag: leads.pipelineFlag,
      botSummary: leads.botSummary,
      quoteTotal: leads.quoteTotal,
      ghlContactId: leads.ghlContactId,
      ghlOpportunityId: leads.ghlOpportunityId,
      ghlBackfilledAt: leads.ghlBackfilledAt,
      ghlChatImportedAt: leads.ghlChatImportedAt,
      notes: leads.notes,
      quoteAlt: leads.quoteAlt,
      leadSource: leads.leadSource,
      source: leads.source,
      followUpDate: leads.followUpDate,
      qState: leads.qState,
      factorySpecDraft: leads.factorySpecDraft,
    })
    .from(leads)
    .where(sql`${leads.active} = true`)
    .orderBy(leads.createdAt);
  let filtered = rows.filter((r) => r.phoneE164 || r.waJid);
  if (args.sid) {
    filtered = filtered.filter((r) => r.manychatSubId === args.sid);
  }
  return args.limit ? filtered.slice(0, args.limit) : filtered;
}

async function cacheContact(sid: string, contactId: string): Promise<void> {
  await db
    .update(leads)
    .set({ ghlContactId: contactId, updatedAt: new Date() })
    .where(eq(leads.manychatSubId, sid));
}

async function cacheOpportunity(
  sid: string,
  oppId: string
): Promise<void> {
  await db
    .update(leads)
    .set({ ghlOpportunityId: oppId, updatedAt: new Date() })
    .where(eq(leads.manychatSubId, sid));
}

async function markBackfilled(sid: string): Promise<void> {
  await db
    .update(leads)
    .set({ ghlBackfilledAt: new Date() })
    .where(eq(leads.manychatSubId, sid));
}

async function markChatImported(sid: string): Promise<void> {
  await db
    .update(leads)
    .set({ ghlChatImportedAt: new Date() })
    .where(eq(leads.manychatSubId, sid));
}

interface Stats {
  scanned: number;
  skippedResume: number;
  skippedNoStage: number;
  contactsUpserted: number;
  opportunitiesCreated: number;
  opportunitiesUpdated: number;
  notesWritten: number;
  historyNotesWritten: number;
  summaryNotesWritten: number;
  decisionNotesWritten: number;
  activityNotesWritten: number;
  inboundMsgsPushed: number;
  outboundMsgsPushed: number;
  errors: number;
}

async function loadMessagesForLead(
  sid: string
): Promise<Array<{ direction: string; sender: string | null; text: string | null; receivedAt: Date }>> {
  return db
    .select({
      direction: messages.direction,
      sender: messages.sender,
      text: messages.text,
      receivedAt: messages.receivedAt,
    })
    .from(messages)
    .where(eq(messages.manychatSubId, sid))
    .orderBy(asc(messages.receivedAt));
}

function formatHistoryNote(
  rows: Array<{ direction: string; sender: string | null; text: string | null; receivedAt: Date }>
): string {
  const labelMap: Record<string, string> = {
    lead: "📥 לקוח",
    bot: "🤖 בוט",
    eli: "📤 אלי",
  };
  const lines: string[] = ["💬 WhatsApp history (imported)\n"];
  for (const r of rows) {
    const text = r.text?.trim();
    if (!text) continue;
    const ts = new Date(r.receivedAt).toISOString().slice(0, 16).replace("T", " ");
    const label = labelMap[r.sender ?? ""] ?? (r.direction === "in" ? "📥" : "📤");
    lines.push(`[${ts}] ${label}: ${text}`);
  }
  return lines.join("\n");
}

function formatOrderSummaryNote(lead: LeadRow): string | null {
  const meaningful =
    lead.quoteTotal ||
    lead.quoteAlt ||
    lead.followUpDate ||
    lead.leadSource ||
    lead.qState ||
    lead.factorySpecDraft;
  if (!meaningful) return null;
  const parts: string[] = ["📋 Order summary (imported)\n"];
  if (lead.quoteTotal) parts.push(`Quote total: ${lead.quoteTotal}`);
  if (lead.quoteAlt) parts.push(`Alt quote: ${lead.quoteAlt}`);
  if (lead.followUpDate) parts.push(`Follow-up: ${lead.followUpDate}`);
  if (lead.leadSource) parts.push(`Lead source: ${lead.leadSource}`);
  if (lead.source && lead.source !== "manual") parts.push(`Origin: ${lead.source}`);
  if (lead.qState) {
    parts.push("");
    parts.push("Questionnaire state (q_state):");
    parts.push(JSON.stringify(lead.qState, null, 2));
  }
  if (lead.factorySpecDraft) {
    parts.push("");
    parts.push("Factory spec draft:");
    parts.push(JSON.stringify(lead.factorySpecDraft, null, 2));
  }
  return parts.join("\n");
}

async function loadDecisionsForLead(sid: string) {
  return db
    .select({
      createdAt: botDecisionLog.createdAt,
      inboundText: botDecisionLog.inboundText,
      stageBefore: botDecisionLog.stageBefore,
      stageAfter: botDecisionLog.stageAfter,
      llmRecommended: botDecisionLog.llmRecommended,
      llmIntent: botDecisionLog.llmIntent,
      llmConfidence: botDecisionLog.llmConfidence,
      llmReason: botDecisionLog.llmReason,
      decidedBy: botDecisionLog.decidedBy,
      action: botDecisionLog.action,
      replyText: botDecisionLog.replyText,
      escalationKind: botDecisionLog.escalationKind,
      eliAction: botDecisionLog.eliAction,
      eliIntentOverride: botDecisionLog.eliIntentOverride,
      eliManualReply: botDecisionLog.eliManualReply,
      eliRejectReason: botDecisionLog.eliRejectReason,
      eliStageFrom: botDecisionLog.eliStageFrom,
      eliStageTo: botDecisionLog.eliStageTo,
    })
    .from(botDecisionLog)
    .where(eq(botDecisionLog.manychatSubId, sid))
    .orderBy(desc(botDecisionLog.createdAt))
    .limit(100);
}

function formatDecisionsNote(rows: Awaited<ReturnType<typeof loadDecisionsForLead>>): string | null {
  if (rows.length === 0) return null;
  const lines: string[] = ["🤖 Bot decisions (imported)\n"];
  for (const r of rows) {
    const ts = new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " ");
    lines.push(`--- [${ts}] ---`);
    if (r.inboundText) lines.push(`📥 "${r.inboundText.trim()}"`);
    if (r.stageBefore || r.stageAfter) {
      lines.push(`stage: ${r.stageBefore ?? "—"} → ${r.stageAfter ?? "—"}`);
    }
    if (r.llmRecommended) {
      const conf = typeof r.llmConfidence === "number" ? ` conf=${r.llmConfidence.toFixed(2)}` : "";
      lines.push(`LLM: ${r.llmRecommended} intent=${r.llmIntent ?? "—"}${conf}`);
      if (r.llmReason) lines.push(`  reason: ${r.llmReason}`);
    }
    lines.push(`Code: ${r.decidedBy} action=${r.action}`);
    if (r.replyText) lines.push(`  reply: "${r.replyText}"`);
    if (r.escalationKind) lines.push(`  escalation: ${r.escalationKind}`);
    if (r.eliAction) {
      lines.push(`Eli: ${r.eliAction}`);
      if (r.eliIntentOverride) lines.push(`  intent override: ${r.eliIntentOverride}`);
      if (r.eliManualReply) lines.push(`  manual reply: "${r.eliManualReply}"`);
      if (r.eliRejectReason) lines.push(`  reject reason: ${r.eliRejectReason}`);
      if (r.eliStageFrom || r.eliStageTo) {
        lines.push(`  stage: ${r.eliStageFrom ?? "—"} → ${r.eliStageTo ?? "—"}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

async function loadEventsForLead(sid: string) {
  return db
    .select({
      createdAt: leadEvents.createdAt,
      eventType: leadEvents.eventType,
      actor: leadEvents.actor,
      payload: leadEvents.payload,
    })
    .from(leadEvents)
    .where(eq(leadEvents.manychatSubId, sid))
    .orderBy(desc(leadEvents.createdAt))
    .limit(100);
}

function formatEventsNote(rows: Awaited<ReturnType<typeof loadEventsForLead>>): string | null {
  if (rows.length === 0) return null;
  const lines: string[] = ["📜 Activity log (imported)\n"];
  for (const r of rows) {
    const ts = new Date(r.createdAt).toISOString().slice(0, 16).replace("T", " ");
    const actor = r.actor ? ` · ${r.actor}` : "";
    lines.push(`[${ts}] ${r.eventType}${actor}`);
    if (r.payload && Object.keys(r.payload as object).length > 0) {
      lines.push(`  ${JSON.stringify(r.payload)}`);
    }
  }
  return lines.join("\n");
}

async function processChat(
  lead: LeadRow,
  args: Args,
  stats: Stats
): Promise<void> {
  if (args.resume && lead.ghlChatImportedAt) {
    stats.skippedResume++;
    return;
  }
  if (!lead.ghlContactId) {
    console.warn(`[skip] ${lead.manychatSubId} — chat-to-inbox but no ghl_contact_id`);
    return;
  }

  const msgRows = await loadMessagesForLead(lead.manychatSubId);
  const realMsgs = msgRows.filter((r) => r.text?.trim());

  if (args.dryRun) {
    console.log(
      `[dry-chat] ${lead.manychatSubId} name=${buildLeadDisplayName(lead)} msgs=${realMsgs.length}`
    );
    return;
  }

  let leadErr = 0;
  for (const m of realMsgs) {
    const text = m.text!.trim();
    try {
      if (m.direction === "in") {
        await postInboundMessage({
          contactId: lead.ghlContactId,
          message: text,
          type: "SMS",
        });
        stats.inboundMsgsPushed++;
      } else {
        await postOutboundMessage({
          contactId: lead.ghlContactId,
          message: text,
          type: "SMS",
        });
        stats.outboundMsgsPushed++;
      }
    } catch (err) {
      leadErr++;
      stats.errors++;
      console.error(
        `[err msg] ${lead.manychatSubId} ${m.direction} ${new Date(m.receivedAt).toISOString()}`,
        err instanceof Error ? err.message : err
      );
      // Stop spamming if same lead hits >5 consecutive errors (likely
      // GHL rejected the channel entirely for this contact).
      if (leadErr >= 5) {
        console.error(`[abort lead] too many errors on ${lead.manychatSubId}`);
        return;
      }
    }
    await sleep(RATE_DELAY_MS);
  }

  if (leadErr === 0) {
    await markChatImported(lead.manychatSubId);
  }
}

async function processLead(
  lead: LeadRow,
  args: Args,
  stats: Stats
): Promise<void> {
  // --resume: skip if fully backfilled (avoids duplicate notes on re-run).
  if (args.resume && lead.ghlBackfilledAt) {
    stats.skippedResume++;
    return;
  }

  const stageId = pickStageId(lead);
  if (!stageId) {
    console.warn(
      `[skip] ${lead.manychatSubId} — no stage id (stage=${lead.pipelineStage} flag=${lead.pipelineFlag})`
    );
    stats.skippedNoStage++;
    return;
  }

  const name = buildLeadDisplayName(lead);
  const customFields = buildCustomFieldsPayload(lead);
  const status = pickOpportunityStatus(lead);
  const monetary = lead.quoteTotal ? Number(lead.quoteTotal) : undefined;

  const msgRows = await loadMessagesForLead(lead.manychatSubId);
  const decisionRows = await loadDecisionsForLead(lead.manychatSubId);
  const eventRows = await loadEventsForLead(lead.manychatSubId);
  const hasNotes = !!lead.notes && lead.notes.trim().length > 0;
  const hasHistory = msgRows.some((r) => r.text?.trim());
  const summaryNote = formatOrderSummaryNote(lead);
  const decisionsNote = formatDecisionsNote(decisionRows);
  const eventsNote = formatEventsNote(eventRows);

  if (args.dryRun) {
    console.log(
      `[dry] ${lead.manychatSubId} name=${name} stage=${lead.pipelineStage ?? "NEW"} value=${monetary ?? "-"} notes=${hasNotes} msgs=${msgRows.length} decisions=${decisionRows.length} events=${eventRows.length} summary=${!!summaryNote}`
    );
    return;
  }

  // --- 1. contact upsert ---
  let contactId = lead.ghlContactId;
  if (args.extrasOnly) {
    if (!contactId) {
      console.warn(`[skip] ${lead.manychatSubId} — extras-only but no ghl_contact_id`);
      return;
    }
  } else {
    try {
      const res = await upsertContact({
        locationId: requireGHLLocationId(),
        name,
        phone: lead.phoneE164 ?? undefined,
        source: "backfill",
        customFields,
      });
      contactId = res.contact.id;
      if (contactId !== lead.ghlContactId) {
        await cacheContact(lead.manychatSubId, contactId);
      }
      stats.contactsUpserted++;
    } catch (err) {
      console.error(`[err contact] ${lead.manychatSubId}`, err);
      stats.errors++;
      return;
    }
    await sleep(RATE_DELAY_MS);
  }

  // --- 2. notes (leads.notes → contact note) ---
  if (hasNotes && !args.extrasOnly) {
    try {
      await addContactNote(contactId, `📝 Internal notes\n${lead.notes!.trim()}`);
      stats.notesWritten++;
      await sleep(RATE_DELAY_MS);
    } catch (err) {
      console.error(`[err notes] ${lead.manychatSubId}`, err);
      stats.errors++;
    }
  }

  // --- 3. message history (one combined note per lead) ---
  if (hasHistory && !args.extrasOnly) {
    try {
      await addContactNote(contactId, formatHistoryNote(msgRows));
      stats.historyNotesWritten++;
      await sleep(RATE_DELAY_MS);
    } catch (err) {
      console.error(`[err history] ${lead.manychatSubId}`, err);
      stats.errors++;
    }
  }

  // --- 4. order summary (q_state + factory spec + quote alt + dates) ---
  if (summaryNote) {
    try {
      await addContactNote(contactId, summaryNote);
      stats.summaryNotesWritten++;
      await sleep(RATE_DELAY_MS);
    } catch (err) {
      console.error(`[err summary] ${lead.manychatSubId}`, err);
      stats.errors++;
    }
  }

  // --- 5. bot decisions ---
  if (decisionsNote) {
    try {
      await addContactNote(contactId, decisionsNote);
      stats.decisionNotesWritten++;
      await sleep(RATE_DELAY_MS);
    } catch (err) {
      console.error(`[err decisions] ${lead.manychatSubId}`, err);
      stats.errors++;
    }
  }

  // --- 6. activity log ---
  if (eventsNote) {
    try {
      await addContactNote(contactId, eventsNote);
      stats.activityNotesWritten++;
      await sleep(RATE_DELAY_MS);
    } catch (err) {
      console.error(`[err activity] ${lead.manychatSubId}`, err);
      stats.errors++;
    }
  }

  // --- 7. opportunity create or update ---
  if (args.extrasOnly) {
    await markBackfilled(lead.manychatSubId);
    return;
  }
  if (!GHL_PIPELINE_ID) {
    console.warn("GHL_PIPELINE_ID not set — skipping opportunity step");
    await markBackfilled(lead.manychatSubId);
    return;
  }
  try {
    if (lead.ghlOpportunityId) {
      await updateOpportunity(lead.ghlOpportunityId, {
        pipelineId: GHL_PIPELINE_ID,
        pipelineStageId: stageId,
        name,
        status,
        monetaryValue: monetary,
        customFields,
      });
      stats.opportunitiesUpdated++;
    } else {
      try {
        const created = await createOpportunity({
          pipelineId: GHL_PIPELINE_ID,
          pipelineStageId: stageId,
          contactId,
          name,
          status,
          monetaryValue: monetary,
          source: "backfill",
          customFields,
        });
        await cacheOpportunity(lead.manychatSubId, created.id);
        stats.opportunitiesCreated++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Two leads with same phone → already an opportunity. Reattach to it.
        if (msg.includes("duplicate opportunity")) {
          const existing = await findOpportunityForContact(
            contactId,
            GHL_PIPELINE_ID
          );
          if (existing) {
            await updateOpportunity(existing.id, {
              pipelineId: GHL_PIPELINE_ID,
              pipelineStageId: stageId,
              name,
              status,
              monetaryValue: monetary,
              customFields,
            });
            await cacheOpportunity(lead.manychatSubId, existing.id);
            stats.opportunitiesUpdated++;
          } else {
            throw err;
          }
        } else {
          throw err;
        }
      }
    }
  } catch (err) {
    console.error(`[err opp] ${lead.manychatSubId}`, err);
    stats.errors++;
  }

  await sleep(RATE_DELAY_MS);

  await markBackfilled(lead.manychatSubId);
}

async function main(): Promise<void> {
  const args = parseArgs();
  console.log(
    `[backfill] dry-run=${args.dryRun} resume=${args.resume} extras-only=${args.extrasOnly} limit=${args.limit ?? "none"}`
  );

  let rows = await loadLeads(args);
  if (args.extrasOnly || args.chatToInbox) {
    rows = rows.filter((r) => r.ghlContactId);
    const mode = args.chatToInbox ? "chat-to-inbox" : "extras-only";
    console.log(
      `[backfill] ${mode}: ${rows.length} leads with cached ghl_contact_id`
    );
  } else {
    console.log(`[backfill] loaded ${rows.length} active leads with phone/jid`);
  }

  const stats: Stats = {
    scanned: 0,
    skippedResume: 0,
    skippedNoStage: 0,
    contactsUpserted: 0,
    opportunitiesCreated: 0,
    opportunitiesUpdated: 0,
    notesWritten: 0,
    historyNotesWritten: 0,
    summaryNotesWritten: 0,
    decisionNotesWritten: 0,
    activityNotesWritten: 0,
    inboundMsgsPushed: 0,
    outboundMsgsPushed: 0,
    errors: 0,
  };

  for (const lead of rows) {
    stats.scanned++;
    if (stats.scanned % 25 === 0) {
      console.log(
        `[progress] ${stats.scanned}/${rows.length} — contacts=${stats.contactsUpserted} opps+=${stats.opportunitiesCreated} opps~=${stats.opportunitiesUpdated} skipped=${stats.skippedResume + stats.skippedNoStage} errors=${stats.errors}`
      );
    }
    if (args.chatToInbox) {
      await processChat(lead, args, stats);
    } else {
      await processLead(lead, args, stats);
    }
  }

  console.log("\n=== done ===");
  console.log(JSON.stringify(stats, null, 2));
  process.exit(stats.errors > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("[backfill] fatal", e);
  process.exit(1);
});
