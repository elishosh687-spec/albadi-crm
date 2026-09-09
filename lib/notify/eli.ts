// Send Eli a WhatsApp DM via the bridge. Target stored in ELI_NOTIFY_JID
// (E.164 phone string or pre-resolved JID). Soft-fails — a missing env or
// bridge error should never break the cron that triggers it.

import { sendBridgeMessage, resolveJidFromPhone } from "../bridge/client";
import { isJid } from "../bridge/jid";
import { captureSend } from "../bot-playground/capture";
import { logger } from "@/lib/observability/log";

const log = logger("notify");

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

export async function sendEliDM(text: string): Promise<"sent" | "dry_run" | "no_jid" | "error"> {
  // Bot playground — capture instead of DMing Eli for real, and label it so
  // the playground can render it as an internal alert rather than a customer
  // message. Without this the DM would still be caught by sendBridgeMessage,
  // but would show up as if the customer received it.
  if (captureSend({ kind: "eli_dm", text, sender: "bot" })) {
    return "dry_run";
  }
  // Test-only short-circuit (mirrors sendBridgeMessage dry-run). Skips JID
  // resolution AND send so test scripts run without network access.
  if (process.env.BRIDGE_DRY_RUN === "1") {
    log.info("eli_dm.dry_run", { textPreview: text.slice(0, 80) });
    return "dry_run";
  }
  try {
    const jid = await resolveEliJid();
    if (!jid) {
      log.warn("eli_dm.no_jid", { reason: "ELI_NOTIFY_JID not set or unresolvable" });
      return "no_jid";
    }
    log.info("eli_dm.sending", { chatId: jid });
    await sendBridgeMessage(jid, text);
    log.info("eli_dm.sent", { chatId: jid });
    return "sent";
  } catch (e) {
    log.error("eli_dm.failed", e);
    return "error";
  }
}
