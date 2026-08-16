/**
 * Per-lead / per-deal proof of what actually reached Meta.
 *
 * The counters on the health strip say "12 tagged, all reported" — true, but
 * unfalsifiable: you cannot tell whether the lead you just tagged is one of the
 * 12, and a deal whose Purchase never sent showed up nowhere at all (Purchase
 * had no stamp until 2026-08-14). This lists every row by name with its state,
 * which is what makes a silent failure visible.
 *
 * Read-only: it reports, it never sends.
 */
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { listClosedQuotes } from "@/lib/factory/server/closed";

export type ReportState =
  | "sent"
  | "pending"
  | "no_meta_id"
  | "not_from_meta"
  | "failed";

export interface ReportedLead {
  name: string;
  state: ReportState;
  /** Why it can't be reported / what failed, when that applies. */
  note?: string;
  /** ILS, deals only. */
  valueIls?: number;
}

export interface MetaReportingStatus {
  qualified: ReportedLead[];
  purchases: ReportedLead[];
  /**
   * Revenue from leads that DID come from Meta but carry no attribution key —
   * a real gap. Customers who never came from an ad are excluded: there is
   * nothing to report for them, and counting them made the panel cry wolf.
   */
  unreportedRevenueIls: number;
}

export async function getMetaReportingStatus(): Promise<MetaReportingStatus> {
  // Source of truth = listClosedQuotes(), the SAME set the backfill reports on.
  // Querying closed_deal_at directly used a narrower definition of "deal" (it
  // misses a quote whose lead is WON), so a genuinely-reported customer —
  // איציק חודידה — was absent from the panel entirely.
  const deals = await listClosedQuotes();

  const attrRows = await db.execute<{
    sid: string;
    from_meta: boolean;
    has_key: boolean;
  }>(sql`
    SELECT trim(manychat_sub_id) AS sid,
           (lead_source = 'facebook' OR source = 'facebook_import'
            OR meta_ad_name IS NOT NULL) AS from_meta,
           (meta_leadgen_id IS NOT NULL OR meta_fbclid IS NOT NULL) AS has_key
    FROM leads`);
  const attr = new Map(attrRows.rows.map((r) => [r.sid, r]));

  const stampRows = await db.execute<{
    id: string;
    sent_at: string | null;
    err: string | null;
  }>(sql`
    SELECT id, meta_purchase_sent_at::text AS sent_at, meta_purchase_error AS err
    FROM factory_quote_requests`);
  const stamps = new Map(stampRows.rows.map((r) => [r.id, r]));

  let unreportedRevenueIls = 0;
  const purchases: ReportedLead[] = deals.map((d) => {
    const name = d.customerName ?? d.leadSid ?? "—";
    const value = d.grandTotalExVat;
    const a = attr.get((d.leadSid ?? "").trim());
    const st = stamps.get(d.id);

    if (st?.sent_at) return { name, state: "sent", valueIls: value };
    if (!a?.has_key) {
      // Never came from an ad → nothing to report, and not a fault.
      if (!a?.from_meta) {
        return {
          name,
          state: "not_from_meta",
          note: "הלקוח לא הגיע ממודעה — אין מה לדווח",
          valueIls: value,
        };
      }
      unreportedRevenueIls += value;
      return {
        name,
        state: "no_meta_id",
        note: "הגיע ממטא אך חסר מזהה — לא ניתן לשייך למודעה",
        valueIls: value,
      };
    }
    if (st?.err) return { name, state: "failed", note: st.err, valueIls: value };
    return { name, state: "pending", valueIls: value };
  });

  // Good-lead side: ask the poller (dry) rather than re-implementing its rules,
  // so this panel can never disagree with what the cron will actually do.
  let qualified: ReportedLead[] = [];
  try {
    const { pollGoodLeads } = await import("@/lib/meta/good-lead-poll");
    const poll = await pollGoodLeads({ dry: true });
    qualified = (poll.breakdown ?? []).map((b) => ({
      name: b.name,
      state: b.status === "no_meta_id" ? "no_meta_id" : b.status,
      note:
        b.status === "no_meta_id"
          ? "אין מזהה מטא לליד — לא ניתן לשייך למודעה"
          : undefined,
    }));
    if (poll.noLeadRow) {
      qualified.push({
        name: `${poll.noLeadRow} אנשי קשר מתויגים ללא ליד במערכת`,
        state: "no_meta_id",
        note: "מתויגים ב-GHL אך אין להם רשומה ב-CRM",
      });
    }
  } catch {
    // GHL unreachable — the deals half is still worth showing.
  }

  return { qualified, purchases, unreportedRevenueIls: Math.round(unreportedRevenueIls) };
}
