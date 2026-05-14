import { db } from "@/lib/db";
import { leadTags, leads, messages } from "@/drizzle/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { ConversationsLayout } from "./_components/ConversationsLayout";
import type { ChatMessage } from "./_components/ChatThread";
import type { OrderSummaryData } from "./_components/OrderSummary";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

// Show every lead in the list (not just those with recent messages). The
// search box in ConversationsLayout filters this superset client-side, so
// Eli can find any lead by name/phone even if there's no message history.
const THREAD_LIMIT = 200;

export interface ConversationRow {
  sid: string;
  name: string | null;
  phone: string | null;
  stage: string | null;
  flag: string | null;
  botPaused: boolean;
  lastText: string | null;
  lastSender: "lead" | "bot" | "eli";
  lastAt: string | null;
  inboundLast24h: number;
}

export default async function V3ConversationsPage({
  searchParams,
}: {
  searchParams: Promise<{ lead?: string }>;
}) {
  const { lead: leadParam } = await searchParams;
  const selectedSid = leadParam?.trim() || null;

  // ---- LIST: every active lead, with last-message metadata --------------
  const leadList = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      stage: leads.pipelineStage,
      flag: leads.pipelineFlag,
      botPaused: leads.botPaused,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .where(eq(leads.active, true))
    .orderBy(desc(leads.updatedAt));

  const sids = leadList.map((l) => l.sid.trim());

  // Combine the N+1 lookups into TWO single SQL queries (was 240 concurrent
  // queries before — Neon was returning "too_many_connections" intermittently).
  // Both use window functions / GROUP BY to fan-out over all leads in one shot.
  type LastMsgRow = {
    sid: string;
    direction: string;
    sender: string | null;
    text: string | null;
    receivedAt: Date;
  };
  type UnreadRow = { sid: string; count: number };

  const [lastMsgRows, unreadRows] =
    sids.length === 0
      ? [[] as LastMsgRow[], [] as UnreadRow[]]
      : await Promise.all([
          db.execute<LastMsgRow>(sql`
            SELECT sid, direction, sender, text, "receivedAt" FROM (
              SELECT
                trim(manychat_sub_id) AS sid,
                direction,
                sender,
                text,
                received_at AS "receivedAt",
                ROW_NUMBER() OVER (
                  PARTITION BY trim(manychat_sub_id)
                  ORDER BY received_at DESC
                ) AS rn
              FROM messages
              WHERE trim(manychat_sub_id) IN ${sids}
            ) t WHERE rn = 1
          `),
          db.execute<UnreadRow>(sql`
            SELECT trim(manychat_sub_id) AS sid, count(*)::int AS count
            FROM messages
            WHERE trim(manychat_sub_id) IN ${sids}
              AND direction = 'in'
              AND received_at > now() - interval '24 hours'
            GROUP BY trim(manychat_sub_id)
          `),
        ]);

  const lastMsgBySid = new Map<string, LastMsgRow>();
  for (const r of lastMsgRows as unknown as LastMsgRow[]) {
    lastMsgBySid.set(r.sid, r);
  }
  const unreadBySid = new Map<string, number>();
  for (const r of unreadRows as unknown as UnreadRow[]) {
    unreadBySid.set(r.sid, Number(r.count));
  }

  const unsorted: ConversationRow[] = leadList.map((lead) => {
    const sid = lead.sid.trim();
    const last = lastMsgBySid.get(sid) ?? null;
    const senderResolved: "lead" | "bot" | "eli" =
      (last?.sender as "lead" | "bot" | "eli" | null) ??
      (last?.direction === "in" ? "lead" : "bot");
    return {
      sid: lead.sid,
      name: lead.name,
      phone: lead.phone,
      stage: lead.stage,
      flag: lead.flag,
      botPaused: lead.botPaused,
      lastText: last?.text ?? null,
      lastSender: senderResolved,
      lastAt:
        last?.receivedAt
          ? new Date(last.receivedAt).toISOString()
          : lead.updatedAt.toISOString(),
      inboundLast24h: unreadBySid.get(sid) ?? 0,
    };
  });

  // Most-recent activity first (last message, falling back to lead.updatedAt).
  const rows = unsorted.sort((a, b) => {
    const ta = a.lastAt ? new Date(a.lastAt).getTime() : 0;
    const tb = b.lastAt ? new Date(b.lastAt).getTime() : 0;
    return tb - ta;
  });

  // ---- SELECTED LEAD: full thread + summary --------------------------------
  let selected: {
    sid: string;
    summary: OrderSummaryData;
    messages: ChatMessage[];
  } | null = null;

  if (selectedSid) {
    const [leadRow] = await db
      .select({
        sid: leads.manychatSubId,
        name: leads.name,
        phone: leads.phoneE164,
        stage: leads.pipelineStage,
        flag: leads.pipelineFlag,
        botPaused: leads.botPaused,
        botSummary: leads.botSummary,
        notes: leads.notes,
        quoteTotal: leads.quoteTotal,
        quoteAlt: leads.quoteAlt,
        qState: leads.qState,
      })
      .from(leads)
      .where(sql`trim(${leads.manychatSubId}) = ${selectedSid}`)
      .limit(1);

    if (leadRow) {
      const [tagRows, msgRows] = await Promise.all([
        db
          .select({ tag: leadTags.tag })
          .from(leadTags)
          .where(sql`trim(${leadTags.manychatSubId}) = ${selectedSid}`),
        db
          .select({
            id: messages.id,
            direction: messages.direction,
            sender: messages.sender,
            text: messages.text,
            receivedAt: messages.receivedAt,
          })
          .from(messages)
          .where(sql`trim(${messages.manychatSubId}) = ${selectedSid}`)
          .orderBy(asc(messages.receivedAt))
          .limit(THREAD_LIMIT),
      ]);

      const summary: OrderSummaryData = {
        name: leadRow.name,
        phone: leadRow.phone,
        stage: leadRow.stage,
        flag: leadRow.flag,
        flags: tagRows.map((t) => t.tag),
        botPaused: leadRow.botPaused,
        botSummary: leadRow.botSummary,
        notes: leadRow.notes,
        quoteTotal: leadRow.quoteTotal,
        quoteAlt: leadRow.quoteAlt,
        qState: (leadRow.qState as Record<string, unknown> | null) ?? null,
      };

      const threadMessages: ChatMessage[] = msgRows.map((m) => ({
        id: m.id,
        direction: m.direction as "in" | "out",
        sender: (m.sender as "lead" | "bot" | "eli" | null) ?? null,
        text: m.text,
        receivedAt: m.receivedAt.toISOString(),
      }));

      selected = { sid: selectedSid, summary, messages: threadMessages };
    }
  }

  return <ConversationsLayout rows={rows} selected={selected} />;
}
