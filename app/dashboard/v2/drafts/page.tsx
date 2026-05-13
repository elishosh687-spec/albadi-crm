import Link from "next/link";
import { db } from "@/lib/db";
import { botDrafts, leads, messages } from "@/drizzle/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { Page } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { colors, fontStack, size, space } from "@/lib/ui/tokens";
import { DraftQueue, type DraftRow } from "./DraftQueue";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

export default async function DraftsPage() {
  const drafts = await db
    .select()
    .from(botDrafts)
    .where(eq(botDrafts.status, "pending"))
    .orderBy(desc(botDrafts.generatedAt))
    .limit(100);

  let rows: DraftRow[] = [];
  if (drafts.length > 0) {
    const subIds = Array.from(new Set(drafts.map((d) => d.manychatSubId.trim())));

    const [leadRows, lastInbound] = await Promise.all([
      Promise.all(
        subIds.map((sid) =>
          db
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
            })
            .from(leads)
            .where(sql`trim(${leads.manychatSubId}) = ${sid}`)
            .limit(1)
            .then((r) => r[0] ?? null)
        )
      ),
      Promise.all(
        subIds.map((sid) =>
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

    const leadBySid = new Map<string, (typeof leadRows)[number]>();
    leadRows.forEach((row, i) => leadBySid.set(subIds[i], row));
    const inboundBySid = new Map<string, (typeof lastInbound)[number]>();
    lastInbound.forEach((row, i) => inboundBySid.set(subIds[i], row));

    rows = drafts.map((d) => {
      const sid = d.manychatSubId.trim();
      const lead = leadBySid.get(sid) ?? null;
      const inbound = inboundBySid.get(sid) ?? null;
      return {
        id: d.id,
        manychatSubId: d.manychatSubId,
        draftText: d.draftText,
        moneyReason: d.moneyReason,
        pipelineStageAtGen: d.pipelineStageAtGen,
        generatedAt: d.generatedAt.toISOString(),
        leadName: lead?.name ?? null,
        leadPhone: lead?.phone ?? null,
        leadStage: lead?.stage ?? null,
        leadFlag: lead?.flag ?? null,
        leadBotSummary: lead?.botSummary ?? null,
        leadBotPaused: lead?.botPaused ?? false,
        lastInboundText: inbound?.text ?? null,
        lastInboundAt: inbound?.receivedAt?.toISOString() ?? null,
      };
    });
  }

  return (
    <div>
      <Page
        title={`תור אישורים — ${rows.length}`}
        description="הצעות תגובה של הבוט לרגעי כסף שמחכות לאישור שלך. הbot מציע — אתה מאשר, עורך, או דוחה."
        actions={
          <Link
            href="/dashboard/v2"
            style={{
              fontFamily: fontStack.body,
              fontSize: size.sm,
              color: colors.accent,
              textDecoration: "none",
              border: `1px solid ${colors.rule}`,
              borderRadius: 4,
              padding: `${space.xs}px ${space.md}px`,
            }}
          >
            ← דאשבורד ראשי
          </Link>
        }
      />

      {rows.length === 0 ? (
        <Card title="אין מה לאשר">
          <p style={{ fontFamily: fontStack.body, fontSize: size.sm, color: colors.inkMuted }}>
            הבוט עוד לא יצר טיוטות. כל הרגעים הכספיים שאסקלצי הבוט יוצרים פה
            כשהפלאג <code>ENABLE_DRAFT_QUEUE=1</code> דולק.
          </p>
        </Card>
      ) : (
        <DraftQueue drafts={rows} />
      )}
    </div>
  );
}
