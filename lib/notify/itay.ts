// Send Itay (the salesperson) a WhatsApp DM via the bridge. Target stored in
// ITAY_NOTIFY_JID (E.164 phone string or pre-resolved JID). Soft-fails — a
// missing env or bridge error must never break the customer send that triggers
// it. Mirrors lib/notify/eli.ts.

import { sendBridgeMessage, resolveJidFromPhone } from "../bridge/client";
import { isJid } from "../bridge/jid";

function readEnv(key: string): string {
  const raw = process.env[key] ?? "";
  return raw.startsWith("﻿") ? raw.slice(1) : raw;
}

let cachedJid: string | null | undefined = undefined;

async function resolveItayJid(): Promise<string | null> {
  if (cachedJid !== undefined) return cachedJid;
  const raw = readEnv("ITAY_NOTIFY_JID").trim();
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

/** Consistent "a quote was sent to a customer" DM used by every customer-send
 *  path (finalized factory quote, combined, draft estimate, on-the-fly estimate).
 *  Eli wants Itay pinged on EVERY send. Fire-and-forget; never throws. */
export async function notifyItayQuoteSent(opts: {
  customerName?: string | null;
  quotationNo?: string | null;
  totalIls?: number | null;
  kind: "draft" | "factory" | "estimate" | "combined";
}): Promise<void> {
  try {
    const kindLabel =
      opts.kind === "draft"
        ? "טיוטה"
        : opts.kind === "estimate"
          ? "אומדן ראשוני"
          : opts.kind === "combined"
            ? "הצעה משולבת"
            : "הצעת מפעל";
    const name = opts.customerName?.trim() || "לקוח";
    const qno = opts.quotationNo ? ` #${opts.quotationNo}` : "";
    const money =
      opts.totalIls != null && opts.totalIls > 0
        ? `\nסה״כ: ₪${Math.round(opts.totalIls).toLocaleString("he-IL")}`
        : "";
    const text = `📤 נשלחה הצעה ללקוח\n${name}${qno}\nסוג: ${kindLabel}${money}`;
    await sendItayDM(text);
  } catch (e) {
    console.warn("[notify.itay] notifyItayQuoteSent failed (ignored)", e);
  }
}

export async function sendItayDM(text: string): Promise<"sent" | "dry_run" | "no_jid" | "error"> {
  if (process.env.BRIDGE_DRY_RUN === "1") {
    const preview = text.length > 100 ? `${text.slice(0, 100)}…` : text;
    console.log(`[notify.itay.dryrun] → ${preview.replace(/\n/g, " ⏎ ")}`);
    return "dry_run";
  }
  try {
    const jid = await resolveItayJid();
    if (!jid) {
      console.warn("[notify.itay] ITAY_NOTIFY_JID not set or unresolvable — skipping DM");
      return "no_jid";
    }
    console.log(`[notify.itay] sending DM → jid=${jid.slice(0, 20)}…`);
    await sendBridgeMessage(jid, text);
    console.log(`[notify.itay] DM sent OK`);
    return "sent";
  } catch (e) {
    console.error("[notify.itay] failed to send:", e);
    return "error";
  }
}
