// Send Eli a WhatsApp DM via the bridge. Target stored in ELI_NOTIFY_JID
// (E.164 phone string or pre-resolved JID). Soft-fails — a missing env or
// bridge error should never break the cron that triggers it.

import { sendBridgeMessage, resolveJidFromPhone } from "../bridge/client";
import { isJid } from "../bridge/jid";

function readEnv(key: string): string {
  const raw = process.env[key] ?? "";
  return raw.startsWith("﻿") ? raw.slice(1) : raw;
}

let cachedJid: string | null | undefined = undefined;

async function resolveEliJid(): Promise<string | null> {
  if (cachedJid !== undefined) return cachedJid;
  const raw = readEnv("ELI_NOTIFY_JID").trim();
  if (!raw) {
    cachedJid = null;
    return null;
  }
  if (isJid(raw)) {
    cachedJid = raw;
    return raw;
  }
  // Phone — resolve via bridge once, cache for the lifetime of the process.
  const jid = await resolveJidFromPhone(raw);
  cachedJid = jid;
  return jid;
}

export async function sendEliDM(text: string): Promise<void> {
  try {
    const jid = await resolveEliJid();
    if (!jid) {
      console.warn("[notify.eli] ELI_NOTIFY_JID not set — skipping DM:", text);
      return;
    }
    await sendBridgeMessage(jid, text);
  } catch (e) {
    console.error("[notify.eli] failed to send:", e);
  }
}
