import { db } from "@/lib/db";
import { leads, messages } from "@/drizzle/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { ConversationsList, type ConversationRow } from "./ConversationsList";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

const PAGE_SIZE = 60;

export default async function V3ConversationsPage() {
  // Pick leads with at least one message, ordered by most recent message.
  const recentRows = await db
    .select({
      sid: messages.manychatSubId,
      lastReceivedAt: sql<string>`max(${messages.receivedAt})::text`,
    })
    .from(messages)
    .groupBy(messages.manychatSubId)
    .orderBy(desc(sql`max(${messages.receivedAt})`))
    .limit(PAGE_SIZE);

  if (recentRows.length === 0) {
    return <ConversationsList rows={[]} />;
  }

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

  const rows: ConversationRow[] = recentRows.map((r, i) => {
    const lead = leadRows[i];
    const last = lastMessages[i];
    return {
      sid: r.sid,
      name: lead?.name ?? null,
      phone: lead?.phone ?? null,
      stage: lead?.stage ?? null,
      flag: lead?.flag ?? null,
      botPaused: lead?.botPaused ?? false,
      lastText: last?.text ?? null,
      lastSender:
        (last?.sender as "lead" | "bot" | "eli" | null) ??
        (last?.direction === "in" ? "lead" : "bot"),
      lastAt: last?.receivedAt?.toISOString() ?? null,
      inboundLast24h: unreadInbound[i] ?? 0,
    };
  });

  return <ConversationsList rows={rows} />;
}
