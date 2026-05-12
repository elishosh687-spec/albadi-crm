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
