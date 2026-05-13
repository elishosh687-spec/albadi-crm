import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { leads, messages as messagesTable } from "@/drizzle/schema";
import { desc, eq, sql } from "drizzle-orm";
import { Page } from "@/components/ui/Page";
import { colors, fontStack, size, space } from "@/lib/ui/tokens";
import { LeadDetailView, type LeadDetailMessage } from "./LeadDetailView";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ sid: string }>;
}) {
  const { sid: rawSid } = await params;
  const sid = decodeURIComponent(rawSid).trim();
  if (!sid) notFound();

  const [lead] = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      jid: leads.waJid,
      pipelineStage: leads.pipelineStage,
      pipelineFlag: leads.pipelineFlag,
      botPaused: leads.botPaused,
      botSummary: leads.botSummary,
      notes: leads.notes,
      quoteTotal: leads.quoteTotal,
      followUpCount: leads.followUpCount,
      lastFollowUpAt: leads.lastFollowUpAt,
    })
    .from(leads)
    .where(sql`trim(${leads.manychatSubId}) = ${sid}`)
    .limit(1);

  if (!lead) notFound();

  const rows = await db
    .select({
      id: messagesTable.id,
      direction: messagesTable.direction,
      text: messagesTable.text,
      receivedAt: messagesTable.receivedAt,
    })
    .from(messagesTable)
    .where(eq(messagesTable.manychatSubId, sid))
    .orderBy(desc(messagesTable.receivedAt))
    .limit(40);

  const messages: LeadDetailMessage[] = rows
    .map((r) => ({
      id: r.id,
      direction: (r.direction === "in" ? "in" : "out") as "in" | "out",
      text: r.text ?? "",
      at: r.receivedAt?.toISOString() ?? null,
    }))
    .reverse();

  return (
    <div>
      <Page
        title={lead.name ?? lead.sid}
        description={`${lead.phone ?? "—"} · שלב ${lead.pipelineStage ?? "NEW"}${lead.pipelineFlag ? ` · ${lead.pipelineFlag}` : ""} · ${lead.followUpCount}/3 פולואפים`}
      />

      <div style={{ marginBottom: space.md }}>
        <Link
          href="/dashboard/v2"
          style={{
            fontFamily: fontStack.body,
            fontSize: size.sm,
            color: colors.accent,
            textDecoration: "none",
          }}
        >
          ← חזרה לדשבורד
        </Link>
      </div>

      <LeadDetailView
        sid={lead.sid}
        name={lead.name}
        phone={lead.phone}
        pipelineStage={lead.pipelineStage}
        pipelineFlag={lead.pipelineFlag}
        botPaused={lead.botPaused}
        botSummary={lead.botSummary}
        notes={lead.notes}
        quoteTotal={lead.quoteTotal}
        messages={messages}
      />
    </div>
  );
}
