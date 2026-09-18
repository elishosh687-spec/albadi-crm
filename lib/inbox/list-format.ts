/**
 * Pure formatting for the שיחות list (ui-ux-pro-max redesign, 18/09): how long
 * ago, how long the customer has been waiting, a readable name when the CRM
 * name is "972… - שם", initials, and who wrote the last line. Client-safe.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "עכשיו" · "לפני 5 דק׳" · "לפני 3 ש׳" · "אתמול" · "לפני 4 ימים" · "12/08". */
export function timeAgo(iso: string | null, now: number): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const d = Math.max(0, now - t);
  if (d < MIN) return "עכשיו";
  if (d < HOUR) return `לפני ${Math.floor(d / MIN)} דק׳`;
  if (d < DAY) return `לפני ${Math.floor(d / HOUR)} ש׳`;
  if (d < 2 * DAY) return "אתמול";
  if (d < 7 * DAY) return `לפני ${Math.floor(d / DAY)} ימים`;
  const dt = new Date(t);
  return `${String(dt.getDate()).padStart(2, "0")}/${String(dt.getMonth() + 1).padStart(2, "0")}`;
}

/** A customer unanswered for longer than this is a stale thread, not "waiting
 *  for you now" — it drops to the regular list instead of topping it. */
export const WAITING_MAX_DAYS = 7;

/** How long a customer has waited for us: "מחכה לך 3 ש׳". Null under 5 minutes
 *  (the bot usually answers by then), past WAITING_MAX_DAYS, or when we wrote last. */
export function waitingLabel(lastAt: string | null, lastSenderIsLead: boolean, now: number): string | null {
  if (!lastSenderIsLead || !lastAt) return null;
  const d = now - new Date(lastAt).getTime();
  if (!Number.isFinite(d) || d < 5 * MIN || d > WAITING_MAX_DAYS * DAY) return null;
  if (d < HOUR) return `מחכה לך ${Math.floor(d / MIN)} דק׳`;
  if (d < DAY) return `מחכה לך ${Math.floor(d / HOUR)} ש׳`;
  const days = Math.floor(d / DAY);
  return days === 1 ? "מחכה לך יום" : `מחכה לך ${days} ימים`;
}

/** "972543987323 - נילי דקור" → "נילי דקור"; empty name → formatted phone. */
export function displayName(name: string | null, phone: string | null): string {
  const n = (name ?? "").trim().replace(/^\+?\d[\d\s-]{6,}\s*[-–|]\s*/, "").trim();
  if (n && !/^\+?[\d\s-]+$/.test(n)) return n;
  const p = (phone ?? n).replace(/\D/g, "");
  if (!p) return "ללא שם";
  const local = p.startsWith("972") ? `0${p.slice(3)}` : p;
  return local.length === 10 ? `${local.slice(0, 3)}-${local.slice(3)}` : local;
}

/** Two letters for the avatar — never digits or punctuation. */
export function initials(label: string): string {
  const words = label.split(/\s+/).map((w) => w.replace(/[^\p{L}]/gu, "")).filter(Boolean);
  if (words.length === 0) return "?";
  // Array.from, not [0]/slice: a non-BMP letter (e.g. 𝓢 in a styled WhatsApp
  // name) is two UTF-16 units — indexing split it and broke hydration (18/09).
  const chars = (w: string) => Array.from(w);
  if (words.length === 1) return chars(words[0]).slice(0, 2).join("").toUpperCase();
  return (chars(words[0])[0] + chars(words[1])[0]).toUpperCase();
}

export function senderPrefix(sender: "lead" | "bot" | "eli" | null): string {
  return sender === "lead" ? "הלקוח" : sender === "eli" ? "אתה" : sender === "bot" ? "בוט" : "";
}

/** WhatsApp placeholders the bridge stores for non-text messages → words. */
const MEDIA: Record<string, string> = {
  imagemessage: "תמונה",
  videomessage: "סרטון",
  audiomessage: "הודעה קולית",
  documentmessage: "מסמך",
  documentwithcaptionmessage: "מסמך",
  contactmessage: "איש קשר",
  contactsarraymessage: "אנשי קשר",
  locationmessage: "מיקום",
  stickermessage: "מדבקה",
  reactionmessage: "תגובה",
  pollmessage: "סקר",
};

export function messagePreview(text: string | null): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  const m = t.match(/^\[(\w+)\]\s*(.*)$/s);
  if (m && MEDIA[m[1].toLowerCase()]) return m[2] ? `${MEDIA[m[1].toLowerCase()]} · ${m[2]}` : MEDIA[m[1].toLowerCase()];
  return t;
}
