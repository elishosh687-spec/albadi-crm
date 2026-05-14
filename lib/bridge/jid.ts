// JID helpers. Bridge stores chats as JIDs ("972…@s.whatsapp.net" or LIDs
// "12345@lid"). The bridge auto-resolves between the two for messaging
// endpoints; we still keep helpers so code can normalise / extract phones.

export function isJid(s: string): boolean {
  return typeof s === "string" && s.includes("@");
}

export function jidToPhone(jid: string): string | null {
  if (!jid || !jid.includes("@")) return null;
  const local = jid.split("@")[0];
  // LID form is not a phone number — caller should hit /v1/lid/resolve.
  if (jid.endsWith("@lid")) return null;
  return local.replace(/[^0-9]/g, "") || null;
}

export function phoneToJid(phone: string): string {
  const digits = String(phone).replace(/[^0-9]/g, "");
  return `${digits}@s.whatsapp.net`;
}

// Resolve a lead row to a bridge recipient. Prefer waJid (already a JID),
// then phoneE164 → JID. Never fall back to manychatSubId as recipient — for
// ManyChat-origin leads, sid is a subscriber id, NOT a phone, so phoneToJid
// would synthesize a non-existent JID and the bridge send would silently
// route to nowhere. Returns null when nothing usable is available.
export function resolveBridgeRecipient(row: {
  waJid: string | null;
  phoneE164?: string | null;
}): string | null {
  if (row.waJid) return row.waJid;
  if (row.phoneE164) return phoneToJid(row.phoneE164);
  return null;
}
