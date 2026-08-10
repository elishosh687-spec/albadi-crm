// "A quote went out to a customer" WhatsApp ping to the salesperson.
//
// Was hardwired to Itay via ITAY_NOTIFY_JID. Since 2026-08-10 the recipient is
// SETTINGS-DRIVEN (`crm.quoteNotify` in app_config, edited from the settings
// screen): off by default, and re-pointable at Itay or any other salesperson
// without a redeploy. The env var remains only as the legacy fallback number.
// Soft-fails everywhere — a notification must never break the customer send.

import { sendBridgeMessage, resolveJidFromPhone } from "../bridge/client";
import { isJid } from "../bridge/jid";
import { loadQuoteNotify } from "./quote-notify-config";

function readEnv(key: string): string {
  const raw = process.env[key] ?? "";
  return raw.startsWith("﻿") ? raw.slice(1) : raw;
}

// Cache resolved JIDs per raw target so re-pointing in settings takes effect
// without a redeploy (the old code cached a single value forever).
const jidCache = new Map<string, string | null>();

async function resolveTargetJid(raw: string): Promise<string | null> {
  const key = raw.trim();
  if (!key) return null;
  if (jidCache.has(key)) return jidCache.get(key) ?? null;
  const jid = isJid(key) ? key : await resolveJidFromPhone(key);
  jidCache.set(key, jid);
  return jid;
}

/** Consistent "a quote was sent to a customer" DM used by every customer-send
 *  path (finalized factory quote, combined, draft estimate, on-the-fly estimate).
 *  No-op when the setting is off. Fire-and-forget; never throws. */
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
    console.warn("[notify.quote] notifyItayQuoteSent failed (ignored)", e);
  }
}

export async function sendItayDM(
  text: string,
): Promise<"sent" | "dry_run" | "disabled" | "no_jid" | "error"> {
  try {
    const cfg = await loadQuoteNotify();
    if (!cfg.enabled) return "disabled";
    // Settings target wins; the env var is the legacy fallback.
    const target = (cfg.phone ?? "").trim() || readEnv("ITAY_NOTIFY_JID").trim();
    if (!target) {
      console.warn("[notify.quote] enabled but no recipient configured — skipping");
      return "no_jid";
    }
    if (process.env.BRIDGE_DRY_RUN === "1") {
      const preview = text.length > 100 ? `${text.slice(0, 100)}…` : text;
      console.log(`[notify.quote.dryrun] → ${preview.replace(/\n/g, " ⏎ ")}`);
      return "dry_run";
    }
    const jid = await resolveTargetJid(target);
    if (!jid) {
      console.warn("[notify.quote] recipient unresolvable — skipping DM");
      return "no_jid";
    }
    await sendBridgeMessage(jid, text);
    console.log("[notify.quote] DM sent OK");
    return "sent";
  } catch (e) {
    console.error("[notify.quote] failed to send:", e);
    return "error";
  }
}
