/**
 * Shared lister for bot_decision_log. Used by:
 *   - GET /api/leads/[sid]/decisions  (Bearer BOT_SECRET, dashboard)
 *   - GET /api/widget/decisions       (widget_token)
 *
 * Filters: lead sid (required-ish — without it returns global tail), action,
 * source. `source` is read-tolerant: if the column doesn't exist yet (pre
 * Phase C1 migration) the filter is silently ignored.
 */

import { db } from "@/lib/db";
import { botDecisionLog } from "@/drizzle/schema";
import { and, desc, eq, sql, SQL } from "drizzle-orm";

export interface ListDecisionsOpts {
  lead?: string;
  limit?: number;
  action?: string;
  source?: string;
}

export async function listDecisions(opts: ListDecisionsOpts = {}) {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const lead = opts.lead?.trim();
  const action = opts.action?.trim();

  const source = opts.source?.trim();

  const where: SQL[] = [];
  if (lead) where.push(sql`trim(${botDecisionLog.manychatSubId}) = ${lead}`);
  if (action && action !== "all") where.push(eq(botDecisionLog.action, action));
  if (source && source !== "all") where.push(eq(botDecisionLog.source, source));

  const rows = await db
    .select()
    .from(botDecisionLog)
    .where(where.length === 1 ? where[0] : where.length > 1 ? and(...where) : undefined)
    .orderBy(desc(botDecisionLog.createdAt))
    .limit(limit);

  return rows;
}
