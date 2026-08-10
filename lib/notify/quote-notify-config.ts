/**
 * WHO gets pinged on WhatsApp when a quote goes out to a customer.
 *
 * This used to be hardwired to Itay via the `ITAY_NOTIFY_JID` env var (the
 * 2026-07 "ping Itay on EVERY send" rule). Eli asked 2026-08-10 to turn it off
 * and to be able to re-point it — at Itay again or at a different salesperson —
 * from the settings screen, without a redeploy. So the target now lives in
 * `app_config` and the env var is only the legacy fallback.
 *
 * Server-only (touches the DB).
 */
import { db } from "@/lib/db";
import { appConfig } from "@/drizzle/schema";
import { eq } from "drizzle-orm";

const KEY = "crm.quoteNotify";

export interface QuoteNotifyConfig {
  /** Off ⇒ nobody is pinged (Eli's default from 2026-08-10). */
  enabled: boolean;
  /** E.164 phone (or a pre-resolved JID) of the person to ping. */
  phone?: string | null;
  /** Display name, for the settings UI only. */
  name?: string | null;
  updatedAt?: string;
}

/** Legacy default: whoever ITAY_NOTIFY_JID pointed at, but DISABLED. */
export const DEFAULT_QUOTE_NOTIFY: QuoteNotifyConfig = { enabled: false };

export async function loadQuoteNotify(): Promise<QuoteNotifyConfig> {
  try {
    const [row] = await db
      .select()
      .from(appConfig)
      .where(eq(appConfig.key, KEY))
      .limit(1);
    const v = row?.value as QuoteNotifyConfig | undefined;
    if (!v || typeof v.enabled !== "boolean") return DEFAULT_QUOTE_NOTIFY;
    return v;
  } catch {
    // Never let a config read break a customer send.
    return DEFAULT_QUOTE_NOTIFY;
  }
}

export async function setQuoteNotify(cfg: QuoteNotifyConfig): Promise<void> {
  const value: QuoteNotifyConfig = {
    enabled: Boolean(cfg.enabled),
    phone: (cfg.phone ?? "").trim() || null,
    name: (cfg.name ?? "").trim() || null,
    updatedAt: new Date().toISOString(),
  };
  await db
    .insert(appConfig)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: appConfig.key, set: { value } });
}
