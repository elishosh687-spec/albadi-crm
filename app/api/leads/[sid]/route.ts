/**
 * DELETE /api/leads/[sid]
 *
 * Hard-delete a lead and every row that references it by manychat_sub_id.
 * Postgres has no FK constraints on these references (they're plain text
 * columns), so we delete dependents explicitly in safe order:
 *   1. lead_tags          (no further references)
 *   2. messages           (conversation history)
 *   3. bot_drafts         (queued / sent autoresponder drafts)
 *   4. factory_quote_requests (quotes tied to this customer)
 *   5. leads              (the row itself)
 *
 * Auth: dashboard cookie (albadi_auth == ADMIN_PASSWORD), same pattern as
 * DELETE /api/factory/[id]. Irreversible.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  botDrafts,
  botQuotes,
  factoryQuoteRequests,
  leadTags,
  leads,
  messages as messagesTable,
} from "@/drizzle/schema";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";

function authorized(req: NextRequest): boolean {
  const cookie = req.cookies.get("albadi_auth");
  return !!cookie && cookie.value === process.env.ADMIN_PASSWORD;
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ sid: string }> }
) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { sid: raw } = await params;
  const sid = decodeURIComponent(raw).trim();
  if (!sid) {
    return NextResponse.json({ error: "missing_sid" }, { status: 400 });
  }

  // Use trim() match because legacy rows carry trailing whitespace on
  // manychat_sub_id (same quirk addressed in lib/bridge/client.ts).
  const sidMatch = sql`trim(${leads.manychatSubId}) = ${sid}`;
  const tagMatch = sql`trim(${leadTags.manychatSubId}) = ${sid}`;
  const msgMatch = sql`trim(${messagesTable.manychatSubId}) = ${sid}`;
  const draftMatch = sql`trim(${botDrafts.manychatSubId}) = ${sid}`;
  const factoryMatch = sql`trim(${factoryQuoteRequests.manychatSubId}) = ${sid}`;

  const counts = {
    leadTags: 0,
    messages: 0,
    botDrafts: 0,
    factoryQuoteRequests: 0,
    botQuotes: 0,
    leads: 0,
  };

  const tagDel = await db.delete(leadTags).where(tagMatch).returning({ id: leadTags.id });
  counts.leadTags = tagDel.length;

  const msgDel = await db
    .delete(messagesTable)
    .where(msgMatch)
    .returning({ id: messagesTable.id });
  counts.messages = msgDel.length;

  const draftDel = await db.delete(botDrafts).where(draftMatch).returning({ id: botDrafts.id });
  counts.botDrafts = draftDel.length;

  const factoryDel = await db
    .delete(factoryQuoteRequests)
    .where(factoryMatch)
    .returning({ id: factoryQuoteRequests.id });
  counts.factoryQuoteRequests = factoryDel.length;

  const quoteDel = await db
    .delete(botQuotes)
    .where(sql`trim(${botQuotes.leadSid}) = ${sid}`)
    .returning({ id: botQuotes.id });
  counts.botQuotes = quoteDel.length;

  const leadDel = await db
    .delete(leads)
    .where(sidMatch)
    .returning({ id: leads.manychatSubId });
  counts.leads = leadDel.length;

  if (counts.leads === 0) {
    // Children might still have been swept, but if the parent row was already
    // gone we treat the whole call as a 404 so the UI can surface "not found"
    // distinctly from a successful delete.
    return NextResponse.json({ error: "not_found", deleted: counts }, { status: 404 });
  }

  return NextResponse.json({ ok: true, deleted: counts });
}
