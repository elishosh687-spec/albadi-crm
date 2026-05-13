import { db } from "@/lib/db";
import { leads, leadTags, messages } from "@/drizzle/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { LeadsBoard, type LeadCardData } from "./_components/LeadsBoard";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export default async function V3LeadsPage() {
  const rows = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      jid: leads.waJid,
      stage: leads.pipelineStage,
      flag: leads.pipelineFlag,
      botSummary: leads.botSummary,
      notes: leads.notes,
      quoteTotal: leads.quoteTotal,
      botPaused: leads.botPaused,
      followUpCount: leads.followUpCount,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .where(eq(leads.active, true))
    .orderBy(desc(leads.updatedAt));

  const sids = rows.map((r) => r.sid.trim());
  const [tagRows, lastIn] = await Promise.all([
    sids.length === 0
      ? Promise.resolve([])
      : db
          .select({ sid: leadTags.manychatSubId, tag: leadTags.tag })
          .from(leadTags)
          .where(sql`trim(${leadTags.manychatSubId}) IN ${sids}`),
    Promise.all(
      sids.map((sid) =>
        db
          .select({ text: messages.text, receivedAt: messages.receivedAt })
          .from(messages)
          .where(
            and(
              sql`trim(${messages.manychatSubId}) = ${sid}`,
              eq(messages.direction, "in")
            )
          )
          .orderBy(desc(messages.receivedAt))
          .limit(1)
          .then((r) => r[0] ?? null)
      )
    ),
  ]);

  const tagsBySid = new Map<string, string[]>();
  for (const t of tagRows) {
    const key = t.sid.trim();
    const arr = tagsBySid.get(key) ?? [];
    arr.push(t.tag);
    tagsBySid.set(key, arr);
  }

  const cards: LeadCardData[] = rows.map((r, i) => ({
    sid: r.sid,
    name: r.name,
    phone: r.phone,
    jid: r.jid,
    stage: r.stage ?? "NEW",
    pipelineFlag: r.flag,
    flags: tagsBySid.get(r.sid.trim()) ?? [],
    botSummary: r.botSummary,
    notes: r.notes,
    quoteTotal: r.quoteTotal,
    botPaused: r.botPaused,
    followUpCount: r.followUpCount,
    lastInboundText: lastIn[i]?.text ?? null,
    lastInboundAt: lastIn[i]?.receivedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  }));

  return <LeadsBoard cards={cards} />;
}
