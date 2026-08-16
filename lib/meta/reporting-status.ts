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
import { customerTotalExVat } from "@/lib/factory/customer-total";
import type { FactoryPricingResult } from "@/lib/factory/types";

export type ReportState = "sent" | "pending" | "no_meta_id" | "failed";

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
  /** Deals whose money never reached Meta — the number that actually matters. */
  unreportedRevenueIls: number;
}

/**
 * Closed deals and whether their Purchase conversion reached Meta.
 *
 * A deal is reportable only if its lead carries a Meta attribution key — a
 * leadgen id (Instant Form) or an fbclid (website). Without one Meta cannot tie
 * the sale to an ad, and no amount of retrying will change that; it is a data
 * gap to fix upstream, not a transient error, so it is labelled distinctly.
 */
export async function getMetaReportingStatus(): Promise<MetaReportingStatus> {
  const dealRows = await db.execute<{
    name: string | null;
    sid: string;
    sent_at: string | null;
    err: string | null;
    value_ils: number | null;
    final_pricing: unknown;
    combined_pricing: { grandTotalIls?: number } | null;
    has_key: boolean;
  }>(sql`
    SELECT l.name,
           f.manychat_sub_id           AS sid,
           f.meta_purchase_sent_at::text AS sent_at,
           f.meta_purchase_error       AS err,
           f.meta_purchase_value_ils   AS value_ils,
           f.final_pricing             AS final_pricing,
           f.combined_pricing          AS combined_pricing,
           (l.meta_leadgen_id IS NOT NULL OR l.meta_fbclid IS NOT NULL) AS has_key
    FROM factory_quote_requests f
    LEFT JOIN leads l ON trim(l.manychat_sub_id) = trim(f.manychat_sub_id)
    WHERE f.closed_deal_at IS NOT NULL
      AND f.deleted_at IS NULL
      -- combined deals stamp on the primary; members would double-count
      AND (f.deal_group_id IS NULL OR f.deal_group_id = concat('dg_', f.id))
    ORDER BY f.closed_deal_at DESC`);

  // The stamped value exists only on a SUCCESSFUL send, so an unreported deal
  // would read ₪0 — precisely the figure we need to be right. Fall back to the
  // deal's own total: the frozen combined offer, else the member's printed total.
  const dealValue = (r: {
    value_ils: number | null;
    combined_pricing: { grandTotalIls?: number } | null;
    final_pricing: unknown;
  }): number | undefined => {
    if (r.value_ils != null) return Number(r.value_ils);
    if (r.combined_pricing?.grandTotalIls != null) return Number(r.combined_pricing.grandTotalIls);
    if (r.final_pricing) {
      return customerTotalExVat(r.final_pricing as FactoryPricingResult) ?? undefined;
    }
    return undefined;
  };

  const purchases: ReportedLead[] = dealRows.rows.map((r) => {
    const name = r.name ?? r.sid;
    const value = dealValue(r);
    if (r.sent_at) return { name, state: "sent", valueIls: value };
    if (!r.has_key) {
      return {
        name,
        state: "no_meta_id",
        note: "אין מזהה מטא לליד — לא ניתן לשייך למודעה",
        valueIls: value,
      };
    }
    if (r.err) return { name, state: "failed", note: r.err, valueIls: value };
    return { name, state: "pending", valueIls: value };
  });

  // Only deals that CAN'T be reported count as lost revenue signal; a pending
  // one is simply waiting for the next run.
  const unreportedRevenueIls = Math.round(
    dealRows.rows
      .filter((r) => !r.sent_at && !r.has_key)
      .reduce((s, r) => s + (dealValue(r) ?? 0), 0),
  );

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

  return { qualified, purchases, unreportedRevenueIls };
}
