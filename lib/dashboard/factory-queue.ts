/**
 * Compute the factory queue sid list — used by app/dashboard/v3/page.tsx as
 * the neighbor list for prev/next paging when from=factory. Matches the
 * ordering shown in FactoryQuotesView (most-recent createdAt first).
 */

import { db } from "@/lib/db";
import { factoryQuoteRequests } from "@/drizzle/schema";
import { desc } from "drizzle-orm";

export async function loadFactoryQueueSids(): Promise<string[]> {
  const rows = await db
    .select({ sid: factoryQuoteRequests.manychatSubId })
    .from(factoryQuoteRequests)
    .orderBy(desc(factoryQuoteRequests.createdAt))
    .limit(500);

  // Dedupe — a lead can have many quote requests; want each sid once,
  // preserving the order of its most-recent quote.
  const seen = new Set<string>();
  const sids: string[] = [];
  for (const r of rows) {
    const s = r.sid.trim();
    if (seen.has(s)) continue;
    seen.add(s);
    sids.push(s);
  }
  return sids;
}
