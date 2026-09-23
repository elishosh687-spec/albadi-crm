/**
 * CRM → Google Ads offline conversions — the pure half (plan phase 5,
 * approved by Eli 2026-09-23). Which lead owes Google which event, and the
 * Data Manager API request for it. No DB, no network.
 *
 * Mirrors the Meta loop (lib/meta/capi.ts) on purpose, so both platforms learn
 * from the same moments:
 *   qualified → "CRM – ליד איכותי"        — suitable tag, or stage DISCAVERY and later
 *   quote     → "CRM – נשלחה הצעת מחיר"   — stage CONSIDERATION / WON, or a closed deal
 *   purchase  → "CRM – מקדמה / עסקה"      — a closed deal (listClosedQuotes), real ex-VAT value
 *
 * The actions are ONE_PER_CLICK in Google, so each lead reports each event
 * once; `transactionId` is stable per lead+event so a retry can never double
 * count. Only clicks inside Google's 90-day window are sent.
 *
 * Why Data Manager API: since 15/06/2026 Google blocks the Google Ads API click-conversion upload
 * for accounts that had not used it — Albadi never had.
 */
import { createHash } from "node:crypto";

export type GoogleConvEvent = "qualified" | "quote" | "purchase";

export const QUOTE_STAGES = new Set(["CONSIDERATION", "WON"]);
export const QUALIFIED_STAGES = new Set(["DISCAVERY", "FACTORY_WAIT", "CONSIDERATION", "WON"]);
export const CLICK_WINDOW_DAYS = 90;

export interface ConvLead {
  sid: string;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  /** When the click happened (attribution job) or, failing that, the lead's creation. */
  clickAt: Date;
  stage: string | null;
  suitable: boolean;
  /** When the suitable tag was set, if it was. */
  suitableAt: Date | null;
  email: string | null;
  phoneE164: string | null;
  qualifiedSentAt: Date | null;
  quoteSentAt: Date | null;
  purchaseSentAt: Date | null;
  /** Closed deals of this lead. */
  deals: { closedAt: Date; valueIls: number }[];
}

export interface ConvValues {
  qualifiedValueIls: number;
  quoteValueIls: number;
  actions: Record<GoogleConvEvent, string>;
}

export interface PendingConversion {
  sid: string;
  event: GoogleConvEvent;
  actionId: string;
  at: Date;
  valueIls: number;
  transactionId: string;
}

/** Which events this lead still owes Google. Pure. */
export function pendingConversions(l: ConvLead, v: ConvValues, now: Date): PendingConversion[] {
  if (!l.gclid && !l.gbraid && !l.wbraid) return [];
  if (now.getTime() - l.clickAt.getTime() > CLICK_WINDOW_DAYS * 86_400_000) return [];
  const out: PendingConversion[] = [];
  // Never before the click: Google rejects a conversion that precedes it.
  const after = (d: Date) => new Date(Math.max(d.getTime(), l.clickAt.getTime() + 60_000));
  const hasDeal = l.deals.length > 0;
  const firstDeal = hasDeal ? l.deals.reduce((a, d) => (d.closedAt < a.closedAt ? d : a)) : null;
  const add = (event: GoogleConvEvent, at: Date, valueIls: number) =>
    out.push({ sid: l.sid, event, actionId: v.actions[event], at: after(at), valueIls: Math.round(valueIls * 100) / 100, transactionId: `albadi-${event}-${l.sid.trim()}` });

  const qualified = l.suitable || QUALIFIED_STAGES.has(l.stage ?? "") || hasDeal;
  if (qualified && !l.qualifiedSentAt) add("qualified", l.suitableAt ?? now, v.qualifiedValueIls);
  const quoted = QUOTE_STAGES.has(l.stage ?? "") || hasDeal;
  if (quoted && !l.quoteSentAt) add("quote", now, v.quoteValueIls);
  if (hasDeal && !l.purchaseSentAt) {
    const total = l.deals.reduce((a, d) => a + d.valueIls, 0);
    if (total > 0) add("purchase", firstDeal!.closedAt, total);
  }
  return out;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Google's normalisation: email lowercased + trimmed; phone in E.164. */
export function hashedIdentifiers(email: string | null, phoneE164: string | null): { emailAddress?: string; phoneNumber?: string }[] {
  const out: { emailAddress?: string; phoneNumber?: string }[] = [];
  const e = email?.trim().toLowerCase();
  if (e && e.includes("@")) out.push({ emailAddress: sha256(e) });
  const digits = phoneE164?.replace(/[^0-9]/g, "");
  if (digits && digits.length >= 10) out.push({ phoneNumber: sha256(`+${digits}`) });
  return out;
}

/** RFC 3339 in Israel time (the account's zone), e.g. 2026-09-23T18:30:00+03:00. */
export function israelTimestamp(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZoneName: "longOffset",
  }).formatToParts(d);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const off = (p.timeZoneName ?? "GMT+00:00").replace("GMT", "") || "+00:00";
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second}${off.length === 3 ? `${off}:00` : off}`;
}

/** One Data Manager `events:ingest` body — one conversion action per request. */
export function ingestBody(
  customerId: string,
  actionId: string,
  items: { conv: PendingConversion; lead: Pick<ConvLead, "gclid" | "gbraid" | "wbraid" | "email" | "phoneE164"> }[],
  validateOnly: boolean,
) {
  return {
    destinations: [{ operatingAccount: { accountType: "GOOGLE_ADS", accountId: customerId }, productDestinationId: actionId }],
    encoding: "HEX",
    validateOnly,
    events: items.map(({ conv, lead }) => {
      const ids = hashedIdentifiers(lead.email, lead.phoneE164);
      return {
        eventTimestamp: israelTimestamp(conv.at),
        transactionId: conv.transactionId,
        conversionValue: conv.valueIls,
        currency: "ILS",
        // Required for offline conversions (Google, 23/09: "event_source: Required
        // field is missing"). A CRM stage change is neither web, app, store nor phone.
        eventSource: "OTHER",
        adIdentifiers: lead.gclid ? { gclid: lead.gclid } : lead.gbraid ? { gbraid: lead.gbraid } : { wbraid: lead.wbraid },
        ...(ids.length ? { userData: { userIdentifiers: ids } } : {}),
      };
    }),
  };
}
