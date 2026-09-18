/**
 * CRM evidence per exact Ad ID — leads, suitable leads, closed deals.
 *
 * Grouped by the normalised `leads.meta_ad_id`, never by `meta_ad_name`:
 * the same name exists under several IDs (form and WhatsApp copies,
 * Advantage+ duplicates), and merging them credits one copy with another's
 * results.
 *
 * - Suitable lead = the lead carries the configured GHL tag in `lead_tags`
 *   (mirrored from GHL by resyncContact). NOT `meta_qualified_sent_at`, which
 *   only marks the subset that could be reported to Meta.
 * - Deals come from `listClosedQuotes()` — the same canonical closed-deal
 *   rule (`closed_deal_at` or WON) and `grandTotalExVat` the rest of the CRM
 *   uses. Meta's own Purchase count is never consulted.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { normalizeAdId } from "./ad-id";

export interface CrmLeadRow {
  sid: string;
  metaAdId: string | null;
  metaAdName: string | null;
  suitable: boolean;
}

export interface CrmDealRow {
  sid: string;
  customerName: string | null;
  totalExVat: number;
}

export interface CrmAdEvidence {
  adId: string;
  adNames: string[];
  leads: number;
  suitableLeads: number;
  deals: number;
  dealRevenueExVat: number;
  dealCustomers: string[];
}

export interface CrmEvidence {
  byAdId: Map<string, CrmAdEvidence>;
  /** Leads that name an ad but carry no usable Ad ID — never merged by name. */
  unattributable: { sid: string; adName: string }[];
  /** Ad names that map to more than one Ad ID. */
  nameCollisions: Map<string, string[]>;
}

export function foldCrmEvidence(leads: CrmLeadRow[], deals: CrmDealRow[]): CrmEvidence {
  const byAdId = new Map<string, CrmAdEvidence>();
  const adBySid = new Map<string, string>();
  const unattributable: CrmEvidence["unattributable"] = [];
  const idsByName = new Map<string, Set<string>>();

  for (const l of leads) {
    const id = normalizeAdId(l.metaAdId);
    const name = (l.metaAdName ?? "").trim();
    if (!id) {
      if (name) unattributable.push({ sid: l.sid, adName: name });
      continue;
    }
    adBySid.set(l.sid.trim(), id);
    let e = byAdId.get(id);
    if (!e) {
      e = { adId: id, adNames: [], leads: 0, suitableLeads: 0, deals: 0, dealRevenueExVat: 0, dealCustomers: [] };
      byAdId.set(id, e);
    }
    e.leads += 1;
    if (l.suitable) e.suitableLeads += 1;
    if (name && !e.adNames.includes(name)) e.adNames.push(name);
    if (name) {
      const s = idsByName.get(name) ?? new Set<string>();
      s.add(id);
      idsByName.set(name, s);
    }
  }

  for (const d of deals) {
    const id = adBySid.get(d.sid.trim());
    if (!id) continue;
    const e = byAdId.get(id)!;
    e.deals += 1;
    e.dealRevenueExVat += d.totalExVat;
    const nm = (d.customerName ?? "").trim();
    if (nm && !e.dealCustomers.includes(nm)) e.dealCustomers.push(nm);
  }

  const nameCollisions = new Map<string, string[]>();
  for (const [name, ids] of idsByName) if (ids.size > 1) nameCollisions.set(name, [...ids].sort());

  return { byAdId, unattributable, nameCollisions };
}

export async function loadCrmEvidence(
  suitableTag: string,
  opts: { includeTestLeads?: boolean } = {},
): Promise<CrmEvidence> {
  // `test:` leads (integration fixtures, the kept test:eli-demo deal) never
  // count toward an ad — except in the integration test that seeds them.
  const testFilter = opts.includeTestLeads ? sql`` : sql`AND l.manychat_sub_id NOT LIKE 'test:%'`;
  const res = await db.execute<{ sid: string; meta_ad_id: string | null; meta_ad_name: string | null; suitable: boolean }>(sql`
    SELECT l.manychat_sub_id AS sid, l.meta_ad_id, l.meta_ad_name,
           EXISTS (
             SELECT 1 FROM lead_tags t
             WHERE t.manychat_sub_id = l.manychat_sub_id
               AND lower(btrim(t.tag)) = lower(btrim(${suitableTag}))
           ) AS suitable
    FROM leads l
    WHERE (l.meta_ad_id IS NOT NULL OR l.meta_ad_name IS NOT NULL)
      ${testFilter}`);

  const { listClosedQuotes } = await import("@/lib/factory/server/closed");
  const closed = await listClosedQuotes();
  const deals: CrmDealRow[] = closed
    .filter((d) => (d.leadSid ?? "").trim())
    .map((d) => ({ sid: d.leadSid!.trim(), customerName: d.customerName ?? null, totalExVat: d.grandTotalExVat ?? 0 }));

  return foldCrmEvidence(
    res.rows.map((r) => ({ sid: r.sid, metaAdId: r.meta_ad_id, metaAdName: r.meta_ad_name, suitable: Boolean(r.suitable) })),
    deals,
  );
}
