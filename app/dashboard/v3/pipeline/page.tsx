import { db } from "@/lib/db";
import { leads, messages } from "@/drizzle/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { V2_PIPELINE_STAGES } from "@/lib/manychat/stages";
import { PipelineBoard, type PipelineCard } from "./PipelineBoard";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export default async function V3PipelinePage() {
  const rows = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      stage: leads.pipelineStage,
      flag: leads.pipelineFlag,
      botPaused: leads.botPaused,
      botSummary: leads.botSummary,
      quoteTotal: leads.quoteTotal,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .where(eq(leads.active, true))
    .orderBy(desc(leads.updatedAt));

  const sids = rows.map((r) => r.sid.trim());
  const lastInbound = await Promise.all(
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
  );

  const cards: PipelineCard[] = rows.map((r, i) => ({
    sid: r.sid,
    name: r.name,
    phone: r.phone,
    stage: r.stage ?? "PRE_QUOTE",
    flag: r.flag,
    botPaused: r.botPaused,
    botSummary: r.botSummary,
    quoteTotal: r.quoteTotal,
    lastInboundText: lastInbound[i]?.text ?? null,
    lastInboundAt: lastInbound[i]?.receivedAt?.toISOString() ?? null,
    updatedAt: r.updatedAt.toISOString(),
  }));

  return (
    <PipelineBoard cards={cards} stages={[...V2_PIPELINE_STAGES, "UNCLASSIFIED"]} />
  );
}
