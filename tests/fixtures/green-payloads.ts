/**
 * Green API `messageData` payloads, one per message type the webhook meets.
 * Shapes follow the Green API docs and the rows measured on 2026-09-07
 * (11,010 stored messages) — in particular `quotedMessage`, which carries
 * its text in `extendedTextMessageData.text`, never in `textMessageData`.
 */
import type { GreenMessageData } from "@/lib/greenapi/extract-text";

export const TEXT_MESSAGE: GreenMessageData = {
  typeMessage: "textMessage",
  textMessageData: { textMessage: "היי, כמה עולות 3000 שקיות?" },
};

/** A reply to an earlier message — how WhatsApp encodes ANY "reply". */
export const QUOTED_MESSAGE: GreenMessageData = {
  typeMessage: "quotedMessage",
  extendedTextMessageData: {
    text: "איך הגעת ל2610?",
    description: "",
  },
  quotedMessage: {
    stanzaId: "3EB0ABCDEF",
    participant: "972559662713@c.us",
    typeMessage: "textMessage",
    textMessage: "הצעת המחיר: 3,000 שקיות ב-₪2,610",
  },
};

/** Link preview / forwarded text — text sits in extendedTextMessageData. */
export const EXTENDED_TEXT_MESSAGE: GreenMessageData = {
  typeMessage: "extendedTextMessage",
  extendedTextMessageData: {
    text: "תראה את זה https://example.com/bag",
    description: "Example bag",
  },
};

/** Only a description — a bare link preview with no typed text. */
export const EXTENDED_DESCRIPTION_ONLY: GreenMessageData = {
  typeMessage: "extendedTextMessage",
  extendedTextMessageData: {
    text: "   ",
    description: "Example bag page",
  },
};

export const IMAGE_WITH_CAPTION: GreenMessageData = {
  typeMessage: "imageMessage",
  fileMessageData: {
    downloadUrl: "https://files.green-api.com/abc/logo.jpg",
    caption: "logo black boxer -2",
    fileName: "logo.jpg",
    mimeType: "image/jpeg",
  },
};

export const IMAGE_NO_CAPTION: GreenMessageData = {
  typeMessage: "imageMessage",
  fileMessageData: {
    downloadUrl: "https://files.green-api.com/abc/logo.jpg",
    caption: "",
    fileName: "logo.jpg",
    mimeType: "image/jpeg",
  },
};

export const STICKER_MESSAGE: GreenMessageData = {
  typeMessage: "stickerMessage",
  fileMessageData: {
    downloadUrl: "https://files.green-api.com/abc/sticker.webp",
    fileName: "sticker.webp",
    mimeType: "image/webp",
  },
};

/** The duplicate-poll-vote case (2026-08-16) — no text anywhere. */
export const POLL_UPDATE_MESSAGE: GreenMessageData = {
  typeMessage: "pollUpdateMessage",
  pollMessageData: {
    stanzaId: "3EB0POLL",
    name: "כמה שקיות?",
    votes: [{ optionName: "3000", optionVoters: ["972502348255@c.us"] }],
  },
};

/** A type nobody has heard of yet. */
export const UNKNOWN_TYPE_MESSAGE: GreenMessageData = {
  typeMessage: "hologramMessage",
  hologramMessageData: { foo: "bar" },
};

/** Malformed — no typeMessage at all. */
export const MISSING_TYPE_MESSAGE: GreenMessageData = {
  textMessageData: { textMessage: "" },
};
