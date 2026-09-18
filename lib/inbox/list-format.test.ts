import { describe, expect, it } from "vitest";
import { displayName, initials, messagePreview, senderPrefix, timeAgo, waitingLabel } from "./list-format";

const NOW = new Date("2026-09-18T20:00:00Z").getTime();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const H = 3_600_000;

describe("inbox list formatting", () => {
  it("says how long ago in short Hebrew", () => {
    expect(timeAgo(ago(20_000), NOW)).toBe("עכשיו");
    expect(timeAgo(ago(5 * 60_000), NOW)).toBe("לפני 5 דק׳");
    expect(timeAgo(ago(3 * H), NOW)).toBe("לפני 3 ש׳");
    expect(timeAgo(ago(30 * H), NOW)).toBe("אתמול");
    expect(timeAgo(ago(4 * 24 * H), NOW)).toBe("לפני 4 ימים");
    expect(timeAgo(null, NOW)).toBe("");
  });

  it("marks a customer waiting for us, not when we wrote last or just now", () => {
    expect(waitingLabel(ago(3 * H), true, NOW)).toBe("מחכה לך 3 ש׳");
    expect(waitingLabel(ago(26 * H), true, NOW)).toBe("מחכה לך יום");
    expect(waitingLabel(ago(3 * H), false, NOW)).toBeNull();
    expect(waitingLabel(ago(60_000), true, NOW)).toBeNull();
    // 60 days unanswered is a stale thread, not "waiting for you now"
    expect(waitingLabel(ago(60 * 24 * H), true, NOW)).toBeNull();
  });

  it("names WhatsApp media placeholders in Hebrew", () => {
    expect(messagePreview("[imageMessage]")).toBe("תמונה");
    expect(messagePreview("[documentMessage] הצעה.pdf")).toBe("מסמך · הצעה.pdf");
    expect(messagePreview("שלום [imageMessage]")).toBe("שלום [imageMessage]");
    expect(messagePreview("  ")).toBeNull();
  });

  it("cleans a phone-prefixed CRM name and falls back to a readable phone", () => {
    expect(displayName("972543987323 - נילי דקור", "+972543987323")).toBe("נילי דקור");
    expect(displayName("Tami Lior Studio", null)).toBe("Tami Lior Studio");
    expect(displayName(null, "+972543987323")).toBe("054-3987323");
    expect(displayName("972543987323", null)).toBe("054-3987323");
  });

  it("makes letter initials only", () => {
    expect(initials("נילי דקור")).toBe("נד");
    expect(initials("Shiran Noy Buchnik")).toBe("SN");
    expect(initials("054-3987323")).toBe("?");
    // styled (non-BMP) letters must not be split into half a surrogate pair
    expect(initials("𝓢𝓱𝓲 𝓛𝓲")).toBe("𝓢𝓛");
    expect(initials("𝓢𝓱𝓲")).toBe("𝓢𝓱");
  });

  it("names who wrote the last line", () => {
    expect(senderPrefix("lead")).toBe("הלקוח");
    expect(senderPrefix("eli")).toBe("אתה");
  });
});
