/**
 * WhatsApp → Zoho bookkeeping bot (private repo elishosh687-spec/zoho-books).
 *
 * Shimon sends payment confirmations / invoices to Albadi's WhatsApp. We hand
 * those, and Eli's "כן 1234" / "לא 1234" answers, to a GitHub Action via
 * repository_dispatch. The Action proposes a Zoho write and asks Eli on
 * WhatsApp; nothing is written to Zoho without Eli's explicit approval.
 *
 * Phone numbers live in env, never in git (this repo is public):
 *   ZOHO_BOT_SHIMON_PHONES  comma-separated digits
 *   ELI_NOTIFY_JID          already used by sendEliDM
 *   ZOHO_BOT_GITHUB_TOKEN   fine-grained PAT, zoho-books only, Contents: read & write
 * Unset token ⇒ the whole feature is off. Never throws, never blocks the webhook
 * for more than 5 seconds — the existing inbound flow runs unchanged after it.
 */
import { logger, serializeError } from "@/lib/observability/log";

const log = logger("zoho");
const REPO = process.env.ZOHO_BOT_REPO || "elishosh687-spec/zoho-books";
const APPROVAL = /^\s*(כן|לא|אשר|מאשר|מאושר|בטל|yes|no|ok|אוקיי|סבבה)(\s+#?\d{4})?\s*$/i;

const digits = (s?: string | null) => (s ?? "").split("@")[0].replace(/\D/g, "");

export type ZohoBotEvent = "wa-shimon" | "wa-eli";

export function zohoBotRoute(chatId: string, text: string | null): ZohoBotEvent | null {
  if (!process.env.ZOHO_BOT_GITHUB_TOKEN) return null;
  const d = digits(chatId);
  if (!d) return null;
  const shimon = (process.env.ZOHO_BOT_SHIMON_PHONES ?? "").split(",").map(digits).filter(Boolean);
  if (shimon.includes(d)) return "wa-shimon";
  const eli = digits(process.env.ELI_NOTIFY_JID);
  if (eli && d === eli && text && APPROVAL.test(text)) return "wa-eli";
  return null;
}

export async function dispatchZohoBot(
  event: ZohoBotEvent,
  payload: { idMessage?: string; text?: string | null; typeMessage?: string },
): Promise<void> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/dispatches`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.ZOHO_BOT_GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "albadi-crm",
      },
      body: JSON.stringify({
        event_type: event,
        client_payload: {
          idMessage: payload.idMessage ?? "",
          typeMessage: payload.typeMessage ?? "",
          text: (payload.text ?? "").slice(0, 500),
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 204) log.info("dispatched", { event, idMessage: payload.idMessage });
    else log.warn("dispatch_failed", { event, status: res.status });
  } catch (e) {
    log.error("dispatch_error", e, { event, err: serializeError(e) });
  }
}
