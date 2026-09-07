/**
 * The one definition of "what did this WhatsApp message actually say".
 *
 * WHY THIS IS ITS OWN MODULE: the webhook and the backfill script must share
 * one extractor. Two copies drift the moment WhatsApp adds a message type, and
 * the backfill would then "repair" rows into a shape the live path no longer
 * produces. Same reasoning as lib/factory/molds.ts and payment-terms.ts.
 *
 * WHY IT EXISTS AT ALL (measured 2026-09-07): the previous extractor lived in
 * the webhook route and was an ALLOW-LIST — it knew textMessage,
 * extendedTextMessage and media, and returned null for everything else. That
 * silently blanked 1,064 of 11,010 rows (9.7%), including **248 of 248**
 * `quotedMessage` rows — which is how WhatsApp encodes *any* reply to an
 * earlier message, i.e. ordinary behaviour in a sales thread. The text was
 * sitting in `extendedTextMessageData.text` the whole time.
 *
 * The cost was not cosmetic. A blank text means `route` is null, so the
 * webhook skips the stop-word and human-handoff checks and reaches
 * `handleInbound` with an empty string — the cold-start path that re-sends the
 * whole opening block. On 2026-09-01 בתאל asked "איך הגעת ל2610?" and the row
 * stored nothing; the bot never saw the question.
 *
 * So the fix is not "add quotedMessage". It is to make the fallback TOTAL, so
 * that a message type nobody has heard of yet can never again produce a silent
 * blank row.
 */

/** The shape we read. Structural on purpose — no import from the route. */
export interface GreenMessageData {
  typeMessage?: string;
  textMessageData?: { textMessage?: string };
  extendedTextMessageData?: { text?: string; description?: string };
  fileMessageData?: {
    downloadUrl?: string;
    caption?: string;
    fileName?: string;
    mimeType?: string;
  };
  [k: string]: unknown;
}

export interface ExtractedText {
  /**
   * What goes in `messages.text`. Never null when we know the type — falls
   * back to a `[typeMessage]` placeholder so the conversation view shows that
   * *something* arrived rather than an empty bubble.
   */
  store: string | null;
  /**
   * What the bot is allowed to route on. REAL customer text only — never a
   * placeholder, because "[imageMessage]" as an answer to a questionnaire
   * question is worse than no answer at all.
   */
  route: string | null;
}

function clean(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/**
 * Pull the human-readable text out of any Green API messageData.
 *
 * Ordered fallback, tried for EVERY type rather than per known type:
 *   1. textMessageData.textMessage        — plain text
 *   2. extendedTextMessageData.text       — quotedMessage, extendedTextMessage,
 *      (.description)                       link previews, button replies
 *   3. fileMessageData.caption            — media sent with a caption
 *   4. `[typeMessage]` placeholder        — store only, never routed
 */
export function extractMessageText(
  msg: GreenMessageData | null | undefined,
): ExtractedText {
  if (!msg) return { store: null, route: null };

  const real =
    clean(msg.textMessageData?.textMessage) ??
    clean(msg.extendedTextMessageData?.text) ??
    clean(msg.extendedTextMessageData?.description) ??
    clean(msg.fileMessageData?.caption);

  if (real) return { store: real, route: real };

  const type = clean(msg.typeMessage);
  // No text anywhere. Record WHAT arrived; give the bot nothing to answer.
  return { store: type ? `[${type}]` : null, route: null };
}

/**
 * Types whose payload carries a downloadable file, so `fileMessageData` is
 * worth reading. Includes stickers — their `downloadUrl` used to be thrown
 * away entirely.
 */
export const FILE_TYPES = new Set([
  "imageMessage",
  "videoMessage",
  "documentMessage",
  "audioMessage",
  "stickerMessage",
]);

/**
 * Types that count as the customer ATTACHING something — the signal the
 * decision handler turns into "they sent their logo": acknowledge, DM Eli,
 * pause the bot.
 *
 * ⚠️ Stickers are deliberately NOT here, even though they carry a file. A 😂
 * sticker is punctuation, not a deliverable; treating one as a logo submission
 * would pause the bot and page Eli over an emoji.
 */
export const ATTACHMENT_TYPES = new Set([
  "imageMessage",
  "videoMessage",
  "documentMessage",
  "audioMessage",
]);

/** Has a file worth recording (url / filename / mime). */
export function isFileType(t: string | undefined | null): boolean {
  return !!t && FILE_TYPES.has(t);
}

/** Counts as a real attachment for routing purposes. */
export function isAttachmentType(t: string | undefined | null): boolean {
  return !!t && ATTACHMENT_TYPES.has(t);
}
