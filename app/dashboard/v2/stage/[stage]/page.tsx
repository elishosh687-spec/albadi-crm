import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { leads, leadTags } from "@/drizzle/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { Page } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { colors, fontStack, size, space } from "@/lib/ui/tokens";
import { V2_PIPELINE_STAGES } from "@/lib/manychat/stages";
import { StageList, type StageLeadRow } from "./StageList";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

function daysSince(d: Date | string | null): number | null {
  if (!d) return null;
  const t = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  return Math.floor((Date.now() - t) / 86400000);
}

export default async function StageDetailPage({
  params,
}: {
  params: Promise<{ stage: string }>;
}) {
  const { stage } = await params;
  const stageDecoded = decodeURIComponent(stage);

  const isUnclassified = stageDecoded === "UNCLASSIFIED";
  const isValid =
    isUnclassified ||
    (V2_PIPELINE_STAGES as readonly string[]).includes(stageDecoded);
  if (!isValid) notFound();

  const leadRows = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      stage: leads.pipelineStage,
      flag: leads.pipelineFlag,
      summary: leads.botSummary,
      notes: leads.notes,
      qState: leads.qState,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .where(
      isUnclassified
        ? and(eq(leads.active, true), isNull(leads.pipelineStage))
        : and(eq(leads.active, true), eq(leads.pipelineStage, stageDecoded))
    );

  const cleanSids = leadRows.map((r) => r.sid.trim());

  const tagRows = cleanSids.length
    ? await db
        .select({ sid: leadTags.manychatSubId, tag: leadTags.tag })
        .from(leadTags)
        .where(inArray(leadTags.manychatSubId, cleanSids))
    : [];

  const tagsBySid = new Map<string, string[]>();
  for (const t of tagRows) {
    const k = t.sid.trim();
    const arr = tagsBySid.get(k) ?? [];
    arr.push(t.tag);
    tagsBySid.set(k, arr);
  }

  const rows: StageLeadRow[] = leadRows
    .map((r) => {
      const sid = r.sid.trim();
      const tags = tagsBySid.get(sid) ?? [];
      const flags = r.flag && !tags.includes(r.flag) ? [...tags, r.flag] : tags;
      const q = (r.qState ?? null) as { quoteResult?: string } | null;
      return {
        manychatSubId: r.sid,
        name: r.name,
        flags,
        summary: r.summary,
        daysSince: daysSince(r.updatedAt),
        notes: r.notes,
        phone: r.phone,
        quoteResult: q?.quoteResult ?? null,
        currentStage: isUnclassified ? null : stageDecoded,
      };
    })
    .sort((a, b) =>
      (a.name ?? a.manychatSubId).localeCompare(
        b.name ?? b.manychatSubId,
        "he"
      )
    );

  return (
    <div>
      <div style={{ marginBottom: space.md }}>
        <Link
          href="/dashboard/v2"
          style={{ fontFamily: fontStack.body, fontSize: size.sm, color: colors.accent }}
        >
          ← חזרה ל-Inbox
        </Link>
      </div>
      <Page title={`Stage: ${stageDecoded}`} description={`${rows.length} לידים`} />

      <Card>
        <StageList rows={rows} isUnclassified={isUnclassified} />
      </Card>
    </div>
  );
}
