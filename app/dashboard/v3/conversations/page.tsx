import { db } from "@/lib/db";
import { leadTags, leads, messages } from "@/drizzle/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { ConversationsLayout } from "./_components/ConversationsLayout";
import type { ChatMessage } from "./_components/ChatThread";
import type { OrderSummaryData } from "./_components/OrderSummary";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

const LIST_PAGE_SIZE = 80;
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

  // ---- LIST -----------------------------------------------------------------
  const recentRows = await db
    .select({
      sid: messages.manychatSubId,
      lastReceivedAt: sql<string>`max(${messages.receivedAt})::text`,
    })
    .from(messages)
    .groupBy(messages.manychatSubId)
    .orderBy(desc(sql`max(${messages.receivedAt})`))
    .limit(LIST_PAGE_SIZE);

  let rows: ConversationRow[] = [];
  if (recentRows.length > 0) {
    const sids = recentRows.map((r) => r.sid.trim());
    const [leadRows, lastMessages, unreadInbound] = await Promise.all([
      Promise.all(
        sids.map((sid) =>
          db
            .select({
              sid: leads.manychatSubId,
              name: leads.name,
              phone: leads.phoneE164,
              stage: leads.pipelineStage,
              flag: leads.pipelineFlag,
              botPaused: leads.botPaused,
            })
            .from(leads)
            .where(sql`trim(${leads.manychatSubId}) = ${sid}`)
            .limit(1)
            .then((r) => r[0] ?? null)
        )
      ),
      Promise.all(
        sids.map((sid) =>
          db
            .select({
              direction: messages.direction,
              sender: messages.sender,
              text: messages.text,
              receivedAt: messages.receivedAt,
            })
            .from(messages)
            .where(sql`trim(${messages.manychatSubId}) = ${sid}`)
            .orderBy(desc(messages.receivedAt))
            .limit(1)
            .then((r) => r[0] ?? null)
        )
      ),
      Promise.all(
        sids.map((sid) =>
          db
            .select({ count: sql<number>`count(*)::int` })
            .from(messages)
            .where(
              and(
                sql`trim(${messages.manychatSubId}) = ${sid}`,
                eq(messages.direction, "in"),
                sql`${messages.receivedAt} > now() - interval '24 hours'`
              )
            )
            .then((r) => r[0]?.count ?? 0)
        )
      ),
    ]);

    rows = recentRows.map((r, i) => {
      const lead = leadRows[i];
      const last = lastMessages[i];
      const senderResolved: "lead" | "bot" | "eli" =
        (last?.sender as "lead" | "bot" | "eli" | null) ??
        (last?.direction === "in" ? "lead" : "bot");
      return {
        sid: r.sid,
        name: lead?.name ?? null,
        phone: lead?.phone ?? null,
        stage: lead?.stage ?? null,
        flag: lead?.flag ?? null,
        botPaused: lead?.botPaused ?? false,
        lastText: last?.text ?? null,
        lastSender: senderResolved,
        lastAt: last?.receivedAt?.toISOString() ?? null,
        inboundLast24h: unreadInbound[i] ?? 0,
      };
    });
  }

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
