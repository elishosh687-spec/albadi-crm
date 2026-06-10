/**
 * One-off end-to-end verification of the ElevenLabs→GHL bridge on the real
 * test call. Posts the note + attaches the recording to the GHL contact, and
 * records the row in elevenlabs_call_imports so the prod cron won't duplicate.
 * Analysis (OpenAI) runs in the prod cron; here we use ElevenLabs' own summary.
 */
import { db } from "../lib/db";
import { elevenlabsCallImports } from "../drizzle/schema";
import {
  getConversation,
  buildTranscriptText,
  extractCallMeta,
  recordingProxyUrl,
} from "../lib/elevenlabs/client";
import {
  findContactByPhone,
  upsertContact,
  addContactNote,
  listContactNotes,
  uploadMediaFromUrl,
  postOutboundMessage,
} from "../integrations/ghl/client";
import {
  GHL_CONVERSATION_PROVIDER_ID,
  requireGHLLocationId,
} from "../integrations/ghl/config";
import { getValidAccessToken } from "../integrations/ghl/oauth";

const CONV = "conv_6601ktmws10cejjsr3zj1fvgh5mv";
const MARKER = `[CALL-ANALYSIS-11L v1] conv=${CONV}`;

function note(meta: any, transcript: string): string {
  const d = meta.startedAt
    ? new Date(meta.startedAt).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })
    : "—";
  const min = meta.durationSec ? `${Math.max(1, Math.round(meta.durationSec / 60))}m` : "—";
  const dir = meta.direction === "outbound" ? "יוצאת" : meta.direction === "inbound" ? "נכנסת" : "—";
  return [
    MARKER,
    `🤖 שיחת סוכן קולי (ElevenLabs): ${d} · ${min} · ${dir}`,
    "",
    `🧭 סיכום: ${meta.summary || "—"}`,
    "",
    "📄 תמלול:",
    transcript,
  ].join("\n");
}

async function main() {
  const detail = await getConversation(CONV);
  const transcript = buildTranscriptText(detail);
  const meta = extractCallMeta(detail);
  console.log("phone:", meta.phone, "| dur:", meta.durationSec, "| dir:", meta.direction);
  console.log("summary:", (meta.summary || "").slice(0, 120));
  if (!meta.phone) {
    console.log("NO PHONE on this conversation — cannot bind a GHL contact.");
    return;
  }

  let contact = await findContactByPhone(meta.phone);
  let contactId = contact?.id ?? null;
  if (!contactId) {
    const created = await upsertContact({ phone: meta.phone, source: "elevenlabs-call" });
    contactId = created.contact.id;
    console.log("created GHL contact:", contactId);
  } else {
    console.log("found GHL contact:", contactId, "(", contact?.contactName ?? "", ")");
  }
  if (!contactId) { console.log("no contact id"); return; }

  const existing = await listContactNotes(contactId);
  let noteId = existing.find((n) => (n.body ?? "").includes(MARKER))?.id ?? null;
  if (!noteId) {
    noteId = (await addContactNote(contactId, note(meta, transcript))).id;
    console.log("posted note:", noteId);
  } else {
    console.log("note already present:", noteId);
  }

  const accessToken = (await getValidAccessToken(requireGHLLocationId())) ?? undefined;
  const providerId = GHL_CONVERSATION_PROVIDER_ID || undefined;
  if (!accessToken || !providerId) {
    console.log("missing accessToken/providerId — skipping audio attach");
  }
  let recUrl: string | null = null;
  let attachedId: string | null = null;
  if (accessToken && providerId) {
    const uploaded = await uploadMediaFromUrl({
      url: recordingProxyUrl(CONV),
      filename: `${CONV}.mp3`,
      mimeType: "audio/mpeg",
      accessToken,
    });
    recUrl = uploaded.url;
    console.log("uploaded recording to GHL media:", uploaded.url);
    const sent = await postOutboundMessage({
      contactId,
      message: "🔊 הקלטת שיחת סוכן קולי",
      type: "Custom",
      conversationProviderId: providerId,
      attachments: [uploaded.url],
      accessToken,
    });
    attachedId = sent.messageId ?? null;
    console.log("attached recording message:", sent.messageId, "| conv:", sent.conversationId);
  }

  await db
    .insert(elevenlabsCallImports)
    .values({
      conversationId: CONV,
      agentId: detail.agent_id,
      phone: meta.phone,
      direction: meta.direction,
      callDurationSec: meta.durationSec,
      callStartedAt: meta.startedAt,
      ghlContactId: contactId,
      transcript,
      elevenSummary: meta.summary,
      enrichedAt: new Date(),
      analyzedAt: new Date(),
      recordingGhlUrl: recUrl,
      postedNoteId: noteId,
      attachedMessageId: attachedId,
      postedBackAt: new Date(),
      status: "posted",
    })
    .onConflictDoUpdate({
      target: elevenlabsCallImports.conversationId,
      set: {
        ghlContactId: contactId,
        postedNoteId: noteId,
        recordingGhlUrl: recUrl,
        attachedMessageId: attachedId,
        postedBackAt: new Date(),
        status: "posted",
        updatedAt: new Date(),
      },
    });

  console.log("\n✅ DONE.");
  console.log("GHL contact id:", contactId);
  console.log("Open in GHL → the contact has: 📝 note + 🔊 playable recording.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
