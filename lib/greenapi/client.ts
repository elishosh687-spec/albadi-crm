/**
 * Green API client — direct alternative to lib/bridge/client.ts.
 *
 * Activated when USE_GREEN_API=1. The public bridge-client functions
 * (sendBridgeMessage, sendCompanyTemplate, sendCtaUrlMessage) check that
 * flag and delegate here so callers stay unchanged.
 *
 * Green API uses a different JID namespace from the bridge:
 *   bridge:  <phone>@s.whatsapp.net  and  <id>@lid
 *   green:   <phone>@c.us            (single namespace, phone-based)
 *
 * Because Green's chatId is always phone-based, we don't have the @lid
 * subscription-priming problem that broke the bridge for form-initiated
 * leads. Inbound poll votes arrive as `pollUpdateMessage` webhooks
 * regardless of who initiated the chat.
 *
 * Env:
 *   GREEN_API_API_URL             https://7107.api.greenapi.com
 *   GREEN_API_ID_INSTANCE         7107621335
 *   GREEN_API_API_TOKEN_INSTANCE  long hex string
 *   GREEN_API_MEDIA_URL           usually same as API_URL
 */
import { db } from "../db";
import { messages as messagesTable, leads } from "../../drizzle/schema";
import { sql } from "drizzle-orm";

const API_URL = (process.env.GREEN_API_API_URL ?? "").replace(/\/$/, "");
const ID_INSTANCE = process.env.GREEN_API_ID_INSTANCE ?? "";
const API_TOKEN = process.env.GREEN_API_API_TOKEN_INSTANCE ?? "";
const MEDIA_URL = (
  process.env.GREEN_API_MEDIA_URL ?? process.env.GREEN_API_API_URL ?? ""
).replace(/\/$/, "");

function requireConfigured(): void {
  if (!API_URL || !ID_INSTANCE || !API_TOKEN) {
    throw new Error(
      "Green API not configured — set GREEN_API_API_URL, GREEN_API_ID_INSTANCE, GREEN_API_API_TOKEN_INSTANCE"
    );
  }
}

function endpoint(path: string): string {
  return `${API_URL}/waInstance${ID_INSTANCE}/${path}/${API_TOKEN}`;
}

function mediaEndpoint(path: string): string {
  return `${MEDIA_URL}/waInstance${ID_INSTANCE}/${path}/${API_TOKEN}`;
}

async function greenPost<T = unknown>(
  path: string,
  body: Record<string, unknown>,
  opts: { media?: boolean } = {}
): Promise<T> {
  requireConfigured();
  const url = (opts.media ? mediaEndpoint : endpoint)(path);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* keep as text */
  }
  if (!res.ok) {
    throw new Error(
      `Green API ${path} failed: ${res.status} ${text.slice(0, 300)}`
    );
  }
  return (json ?? {}) as T;
}

// ───────── identity helpers ─────────

const CHAT_SUFFIX = "@c.us";

/** Digits-only phone → Green chatId. */
export function phoneToChatId(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return `${digits}${CHAT_SUFFIX}`;
}

/** Translate any recipient form we might have stored to Green chatId. */
export async function recipientToChatId(recipient: string): Promise<string> {
  const trimmed = recipient.trim();
  if (!trimmed) throw new Error("recipientToChatId: empty recipient");
  // Already @c.us → use as-is.
  if (trimmed.endsWith(CHAT_SUFFIX)) return trimmed;
  // <phone>@s.whatsapp.net → swap suffix.
  if (trimmed.endsWith("@s.whatsapp.net")) {
    return `${trimmed.slice(0, -"@s.whatsapp.net".length)}${CHAT_SUFFIX}`;
  }
  // <id>@lid — phone unknown from the JID alone. Look up phone_e164 from the
  // lead row keyed on this JID/sid.
  if (trimmed.endsWith("@lid")) {
    const phone = await lookupPhoneByJidOrSid(trimmed);
    if (!phone) {
      throw new Error(
        `recipientToChatId: cannot map @lid '${trimmed}' to phone — no matching lead`
      );
    }
    return phoneToChatId(phone);
  }
  // Bare digits.
  if (/^\d+$/.test(trimmed)) return phoneToChatId(trimmed);
  throw new Error(`recipientToChatId: unrecognised format '${trimmed}'`);
}

async function lookupPhoneByJidOrSid(jid: string): Promise<string | null> {
  const [row] = await db
    .select({ phone: leads.phoneE164 })
    .from(leads)
    .where(
      sql`${leads.waJid} = ${jid} OR trim(${leads.manychatSubId}) = ${jid.trim()}`
    )
    .limit(1);
  return row?.phone ?? null;
}

// ───────── outbound message helper (mirrors bridge's insertBridgeMessage) ─────────

interface InsertOutboundParams {
  chatId: string;
  text: string;
  waMessageId: string;
  sender: "bot" | "eli";
  payload?: Record<string, unknown>;
}

/**
 * Look up the canonical lead sid for this Green chatId. Leads created by
 * /api/leads/facebook-import live under `<phone>@s.whatsapp.net`; leads
 * created by the green webhook for fresh contacts live under `<phone>@c.us`.
 * Outbound messages must be stored under the SAME sid as the lead row,
 * otherwise the CRM conversation view (which filters messages by sid) won't
 * surface them.
 */
async function resolveLeadSidForChatId(chatId: string): Promise<string> {
  // 1. exact chatId match
  const byChat = await db
    .select({ sid: leads.manychatSubId })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${chatId.trim()}`)
    .limit(1);
  if (byChat[0]) return chatId;
  // 2. fall back to phone-based lookup
  const digits = chatId.endsWith(CHAT_SUFFIX)
    ? chatId.slice(0, -CHAT_SUFFIX.length)
    : chatId.replace(/\D/g, "");
  if (digits) {
    const byPhone = await db
      .select({ sid: leads.manychatSubId })
      .from(leads)
      .where(sql`${leads.phoneE164} = ${digits}`)
      .limit(1);
    if (byPhone[0]) return byPhone[0].sid;
  }
  // 3. no lead row yet → use chatId itself; the webhook will reconcile on
  //    the next inbound.
  return chatId;
}

async function insertGreenOutbound(p: InsertOutboundParams): Promise<void> {
  // Never block the send pipeline on a DB hiccup — the message already went
  // out over WhatsApp. Log and move on so the bot can keep running.
  try {
    const canonicalSid = await resolveLeadSidForChatId(p.chatId);
    await db.insert(messagesTable).values({
      manychatSubId: canonicalSid,
      direction: "out",
      text: p.text,
      waMessageId: p.waMessageId,
      sender: p.sender,
      payload: p.payload ?? { from: "greenapi" },
    });
  } catch (e) {
    console.error("[greenapi] insertGreenOutbound failed", {
      chatId: p.chatId,
      waMessageId: p.waMessageId,
      err: e instanceof Error ? e.message : String(e),
    });
  }
}

// ───────── public send functions ─────────

export interface GreenSendResult {
  wa_message_id: string;
  status?: string;
}

/**
 * Drop-in replacement for bridge's sendBridgeMessage. Same signature so
 * callers in lib/bridge/client.ts can delegate without conversion.
 */
export async function sendGreenMessage(
  recipient: string,
  message: string,
  mediaPath?: string,
  sender: "bot" | "eli" = "bot",
  mediaFilename?: string,
  buttons?: { id: string; title: string }[],
  poll?: { question: string; options: string[]; selectableCount?: number }
): Promise<GreenSendResult> {
  if (process.env.BRIDGE_DRY_RUN === "1") {
    const fakeId = `dryrun:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    console.log(`[green.dryrun] → ${recipient}: ${message.slice(0, 100)}`);
    return { wa_message_id: fakeId, status: "dryrun" };
  }
  const chatId = await recipientToChatId(recipient);

  // poll path
  if (poll && poll.options.length >= 2) {
    if (poll.options.length > 12) {
      throw new Error(
        `sendGreenMessage: WhatsApp poll capped at 12 options — got ${poll.options.length}`
      );
    }
    const res = await greenPost<{ idMessage: string }>("sendPoll", {
      chatId,
      message: poll.question,
      options: poll.options.map((o) => ({ optionName: o })),
      multipleAnswers: (poll.selectableCount ?? 1) > 1,
    });
    await insertGreenOutbound({
      chatId,
      text: poll.question,
      waMessageId: res.idMessage,
      sender,
      payload: { from: "sendGreenMessage", kind: "poll", options: poll.options },
    });
    return { wa_message_id: res.idMessage };
  }

  // media path (treats buttons as fallback to numbered text below since
  // Green API removed reliable button support)
  if (mediaPath) {
    const isUrl = /^https?:\/\//i.test(mediaPath);
    if (!isUrl) {
      throw new Error(
        "sendGreenMessage: local media_path not supported — must be a public URL"
      );
    }
    const res = await greenPost<{ idMessage: string }>(
      "sendFileByUrl",
      {
        chatId,
        urlFile: mediaPath,
        fileName: mediaFilename || mediaPath.split("/").pop() || "file",
        caption: message || undefined,
      },
      { media: true }
    );
    await insertGreenOutbound({
      chatId,
      text: message,
      waMessageId: res.idMessage,
      sender,
      payload: { from: "sendGreenMessage", kind: "file", url: mediaPath },
    });
    return { wa_message_id: res.idMessage };
  }

  // buttons → degrade to numbered text. Green API's button endpoint is
  // unreliable since WhatsApp deprecated it for non-Cloud API senders. We
  // still surface the choices to the user, but as text.
  let outText = message;
  if (buttons && buttons.length > 0) {
    const lines = buttons
      .map((b, i) => `${i + 1}. ${b.title}`)
      .join("\n");
    outText = `${message}\n\n${lines}`;
  }

  const res = await greenPost<{ idMessage: string }>("sendMessage", {
    chatId,
    message: outText,
  });
  await insertGreenOutbound({
    chatId,
    text: outText,
    waMessageId: res.idMessage,
    sender,
    payload: { from: "sendGreenMessage", kind: "text" },
  });
  return { wa_message_id: res.idMessage };
}

/**
 * Company-template send. Two messages:
 *   1. video (sendFileByUrl) with short caption
 *   2. interactive buttons (sendInteractiveButtons) with Instagram URL button
 *      and sister-site link buttons
 *
 * SendInteractiveButtons has no media-header support, so the video has to be
 * sent as a separate message. Caps: 3 buttons, 25 chars each, body ≤20000.
 */
export const COMPANY_VIDEO_URL =
  process.env.GREEN_COMPANY_VIDEO_URL ||
  "https://albadi.ecobrotherss.com/company-intro.mp4";

const COMPANY_VIDEO_CAPTION =
  "👋 *קצת עלינו — אלבדי*\n\n" +
  "חברת אריזות עם 20+ שנה בענף. שותפים במפעל ייצור בסין. מתמחים בשקיות ממותגות לעסקים.";

const COMPANY_BUTTONS_BODY =
  "🌐 ecobrotherss.com\n" +
  "🌐 packiure.com\n" +
  "🌐 albadi.ecobrotherss.com";

const COMPANY_TEXT_ONLY_FALLBACK =
  COMPANY_VIDEO_CAPTION +
  "\n\n" +
  COMPANY_BUTTONS_BODY +
  "\n\n📸 אינסטגרם: https://www.instagram.com/simonsostri";

export async function sendGreenCompanyTemplate(recipient: string): Promise<void> {
  const chatId = await recipientToChatId(recipient);

  // 1. Video with short caption.
  let videoSent = false;
  try {
    const res = await greenPost<{ idMessage: string }>(
      "sendFileByUrl",
      {
        chatId,
        urlFile: COMPANY_VIDEO_URL,
        fileName: "albadi-company.mp4",
        caption: COMPANY_VIDEO_CAPTION,
      },
      { media: true }
    );
    await insertGreenOutbound({
      chatId,
      text: COMPANY_VIDEO_CAPTION,
      waMessageId: res.idMessage,
      sender: "bot",
      payload: { from: "sendGreenCompanyTemplate", kind: "video+caption" },
    });
    videoSent = true;
  } catch (err) {
    console.warn(
      "[greenapi] company video send failed",
      err instanceof Error ? err.message : err
    );
  }

  // 2. Interactive buttons with Instagram URL.
  try {
    const res = await greenPost<{ idMessage: string }>("sendInteractiveButtons", {
      chatId,
      body: COMPANY_BUTTONS_BODY,
      buttons: [
        {
          type: "url",
          buttonId: "ig",
          buttonText: "📸 אינסטגרם",
          url: "https://www.instagram.com/simonsostri",
        },
      ],
    });
    await insertGreenOutbound({
      chatId,
      text: COMPANY_BUTTONS_BODY,
      waMessageId: res.idMessage,
      sender: "bot",
      payload: { from: "sendGreenCompanyTemplate", kind: "interactive-buttons" },
    });
    return;
  } catch (err) {
    console.warn(
      "[greenapi] interactive buttons failed, sending text fallback",
      err instanceof Error ? err.message : err
    );
  }

  // 3. Last-resort: plain text containing everything (only if buttons failed).
  //    If the video already went out, send only the button-body text + IG link
  //    so we don't repeat the caption.
  const fallbackText = videoSent
    ? `${COMPANY_BUTTONS_BODY}\n\n📸 אינסטגרם: https://www.instagram.com/simonsostri`
    : COMPANY_TEXT_ONLY_FALLBACK;
  const res = await greenPost<{ idMessage: string }>("sendMessage", {
    chatId,
    message: fallbackText,
  });
  await insertGreenOutbound({
    chatId,
    text: fallbackText,
    waMessageId: res.idMessage,
    sender: "bot",
    payload: { from: "sendGreenCompanyTemplate", kind: "text-fallback" },
  });
}

/**
 * cta_url-equivalent for Green: send the body text + the CTA URL appended.
 * WhatsApp renders the URL as a tappable link card. If a header video/image
 * is supplied via mediaId (we keep the parameter for signature parity but
 * Green doesn't have direct media_id — we treat it as a URL or skip).
 */
export interface GreenCtaUrlInput {
  body: string;
  headerType?: "video" | "image" | null;
  mediaId?: string | null;
  mediaUrl?: string | null;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
}

export async function sendGreenCtaUrlMessage(
  recipient: string,
  input: GreenCtaUrlInput
): Promise<GreenSendResult> {
  const chatId = await recipientToChatId(recipient);
  // If a public media URL is supplied with the body, send file with caption.
  if (input.mediaUrl && /^https?:\/\//i.test(input.mediaUrl)) {
    const composedCaption = input.ctaUrl
      ? `${input.body}\n\n👉 ${input.ctaLabel || "פתח"}: ${input.ctaUrl}`
      : input.body;
    const res = await greenPost<{ idMessage: string }>(
      "sendFileByUrl",
      {
        chatId,
        urlFile: input.mediaUrl,
        fileName: input.mediaUrl.split("/").pop() || "media",
        caption: composedCaption,
      },
      { media: true }
    );
    await insertGreenOutbound({
      chatId,
      text: composedCaption,
      waMessageId: res.idMessage,
      sender: "bot",
      payload: {
        from: "sendGreenCtaUrlMessage",
        kind: "media+caption",
        url: input.mediaUrl,
      },
    });
    return { wa_message_id: res.idMessage };
  }
  // Plain text with CTA appended.
  const composed = input.ctaUrl
    ? `${input.body}\n\n👉 ${input.ctaLabel || "פתח"}: ${input.ctaUrl}`
    : input.body;
  const res = await greenPost<{ idMessage: string }>("sendMessage", {
    chatId,
    message: composed,
  });
  await insertGreenOutbound({
    chatId,
    text: composed,
    waMessageId: res.idMessage,
    sender: "bot",
    payload: { from: "sendGreenCtaUrlMessage", kind: "text" },
  });
  return { wa_message_id: res.idMessage };
}

// ───────── contact lookup ─────────

export async function getGreenContactInfo(
  chatIdOrPhone: string
): Promise<{ name?: string; avatar?: string; chatId: string } | null> {
  const chatId = chatIdOrPhone.endsWith(CHAT_SUFFIX)
    ? chatIdOrPhone
    : phoneToChatId(chatIdOrPhone);
  try {
    const r = await greenPost<{
      avatar?: string;
      name?: string;
      contactName?: string;
      chatId: string;
    }>("getContactInfo", { chatId });
    return {
      chatId: r.chatId ?? chatId,
      name: r.contactName || r.name,
      avatar: r.avatar,
    };
  } catch (err) {
    console.warn("[greenapi] getContactInfo failed", err);
    return null;
  }
}

export function isGreenActive(): boolean {
  return process.env.USE_GREEN_API === "1";
}
