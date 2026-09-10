import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_TYPES,
  FILE_TYPES,
  extractMessageText,
  isAttachmentType,
  isFileType,
} from "./extract-text";
import {
  EXTENDED_DESCRIPTION_ONLY,
  EXTENDED_TEXT_MESSAGE,
  IMAGE_NO_CAPTION,
  IMAGE_WITH_CAPTION,
  MISSING_TYPE_MESSAGE,
  POLL_UPDATE_MESSAGE,
  QUOTED_MESSAGE,
  STICKER_MESSAGE,
  TEXT_MESSAGE,
  UNKNOWN_TYPE_MESSAGE,
} from "../../tests/fixtures/green-payloads";

describe("extractMessageText — fallback order", () => {
  it("plain text is stored and routed", () => {
    expect(extractMessageText(TEXT_MESSAGE)).toEqual({
      store: "היי, כמה עולות 3000 שקיות?",
      route: "היי, כמה עולות 3000 שקיות?",
    });
  });

  // Incident 2026-09-01 / measured 2026-09-07: 248 of 248 quotedMessage rows
  // stored empty — בתאל asked "איך הגעת ל2610?" as a reply and the bot never
  // saw the question, then re-sent the whole opening block.
  it("a quotedMessage reply is stored AND routed from extendedTextMessageData.text", () => {
    expect(extractMessageText(QUOTED_MESSAGE)).toEqual({
      store: "איך הגעת ל2610?",
      route: "איך הגעת ל2610?",
    });
  });

  it("extendedTextMessage prefers .text over .description", () => {
    const r = extractMessageText(EXTENDED_TEXT_MESSAGE);
    expect(r.store).toBe("תראה את זה https://example.com/bag");
    expect(r.route).toBe(r.store);
  });

  it("falls through to .description when .text is blank", () => {
    expect(extractMessageText(EXTENDED_DESCRIPTION_ONLY)).toEqual({
      store: "Example bag page",
      route: "Example bag page",
    });
  });

  it("an image caption is real customer text", () => {
    expect(extractMessageText(IMAGE_WITH_CAPTION)).toEqual({
      store: "logo black boxer -2",
      route: "logo black boxer -2",
    });
  });

  it("an image without a caption stores a placeholder and routes nothing", () => {
    expect(extractMessageText(IMAGE_NO_CAPTION)).toEqual({
      store: "[imageMessage]",
      route: null,
    });
  });

  it("a sticker stores a placeholder and routes nothing", () => {
    expect(extractMessageText(STICKER_MESSAGE)).toEqual({ store: "[stickerMessage]", route: null });
  });

  it("a poll vote stores a placeholder and routes nothing", () => {
    expect(extractMessageText(POLL_UPDATE_MESSAGE)).toEqual({
      store: "[pollUpdateMessage]",
      route: null,
    });
  });

  it("a type nobody has heard of still leaves a trace in the conversation", () => {
    expect(extractMessageText(UNKNOWN_TYPE_MESSAGE)).toEqual({
      store: "[hologramMessage]",
      route: null,
    });
  });

  it("no typeMessage and no text → null/null", () => {
    expect(extractMessageText(MISSING_TYPE_MESSAGE)).toEqual({ store: null, route: null });
  });

  it("null / undefined payloads → null/null", () => {
    expect(extractMessageText(null)).toEqual({ store: null, route: null });
    expect(extractMessageText(undefined)).toEqual({ store: null, route: null });
  });

  it("trims whitespace and treats whitespace-only text as absent", () => {
    expect(extractMessageText({ typeMessage: "textMessage", textMessageData: { textMessage: "  שלום  " } })).toEqual({
      store: "שלום",
      route: "שלום",
    });
    expect(extractMessageText({ typeMessage: "textMessage", textMessageData: { textMessage: "   " } })).toEqual({
      store: "[textMessage]",
      route: null,
    });
  });

  it("a non-string text field is ignored rather than coerced", () => {
    expect(
      extractMessageText({ typeMessage: "textMessage", textMessageData: { textMessage: 42 as unknown as string } })
    ).toEqual({ store: "[textMessage]", route: null });
  });
});

describe("file / attachment type sets", () => {
  it("stickers carry a file but are not an attachment", () => {
    expect(FILE_TYPES.has("stickerMessage")).toBe(true);
    expect(ATTACHMENT_TYPES.has("stickerMessage")).toBe(false);
    expect(isFileType("stickerMessage")).toBe(true);
    expect(isAttachmentType("stickerMessage")).toBe(false);
  });

  it("every attachment type is also a file type", () => {
    for (const t of ATTACHMENT_TYPES) expect(FILE_TYPES.has(t)).toBe(true);
  });

  it("image / video / document / audio are attachments", () => {
    for (const t of ["imageMessage", "videoMessage", "documentMessage", "audioMessage"]) {
      expect(isAttachmentType(t)).toBe(true);
      expect(isFileType(t)).toBe(true);
    }
  });

  it("text, polls and missing types are neither", () => {
    for (const t of ["textMessage", "quotedMessage", "pollUpdateMessage", "", null, undefined]) {
      expect(isFileType(t)).toBe(false);
      expect(isAttachmentType(t)).toBe(false);
    }
  });
});
