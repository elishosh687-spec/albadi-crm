import { db } from "@/lib/db";
import { pipelineSuggestions, leads } from "@/drizzle/schema";
import { desc, eq } from "drizzle-orm";
import { Page } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { colors, fontStack, size, space, weight } from "@/lib/ui/tokens";
import { getSubscriber, getFieldValue } from "@/lib/manychat/client";
import { V2_PIPELINE_STAGES, type V2PipelineStage } from "@/lib/manychat/config";
import { InboxList } from "./InboxList";
import type { InboxItem } from "./InboxRow";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

interface LeadSnapshot {
  sid: string;
  name: string | null;
  pipelineStage: V2PipelineStage | null;
  flags: string[];
  quoteTotal: number | null;
  notes: string | null;
  lastInteraction: string | null;
}

async function pullLeadSnapshots(subIds: string[]): Promise<LeadSnapshot[]> {
  const flagNames = new Set([
    "דחוף",
    "עסקה_גדולה",
    "ביקש_שיחה",
    "אחרי_החג",
    "מועדף",
  ]);

  async function pullOne(sid: string): Promise<LeadSnapshot> {
    const cleanSid = sid.trim();
    try {
      const sub = await getSubscriber(cleanSid);
      const stage = getFieldValue(sub.custom_fields, "pipeline_stage");
      const quote = getFieldValue(sub.custom_fields, "quote_total");
      const notes = getFieldValue(sub.custom_fields, "notes");
      const flags = sub.tags
        .map((t) => t.name ?? "")
        .filter((n) => flagNames.has(n));
      return {
        sid: cleanSid,
        name: sub.name ?? null,
        pipelineStage: (stage ? String(stage) : null) as V2PipelineStage | null,
        flags,
        quoteTotal: quote ? Number(quote) : null,
        notes: notes ? String(notes) : null,
        lastInteraction: ((sub as any).last_interaction as string | null) ?? null,
      };
    } catch {
      return {
        sid: cleanSid,
        name: null,
        pipelineStage: null,
        flags: [],
        quoteTotal: null,
        notes: null,
        lastInteraction: null,
      };
    }
  }

  // Parallel with concurrency cap to avoid ManyChat rate limits.
  const CONCURRENCY = 10;
  const out: LeadSnapshot[] = new Array(subIds.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, subIds.length) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= subIds.length) return;
        out[i] = await pullOne(subIds[i]);
      }
    })
  );
  return out;
}

export default async function DashboardV2() {
  const [pendingRows, activeLeads] = await Promise.all([
    db
      .select()
      .from(pipelineSuggestions)
      .where(eq(pipelineSuggestions.status, "pending_review"))
      .orderBy(desc(pipelineSuggestions.createdAt)),
    db
      .select({ id: leads.manychatSubId, name: leads.name })
      .from(leads)
      .where(eq(leads.active, true)),
  ]);

  const uniqueSids = Array.from(
    new Set(activeLeads.map((r) => r.id.trim()))
  );
  const snapshots = await pullLeadSnapshots(uniqueSids);
  const snapshotBySid = new Map(snapshots.map((s) => [s.sid, s]));
  const pendingSids = new Set(pendingRows.map((r) => r.manychatSubId.trim()));

  const formatNum = (n: number | null) =>
    n == null ? null : n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  const inboxItems: InboxItem[] = pendingRows.map((r) => {
    const snap = snapshotBySid.get(r.manychatSubId.trim());
    return {
      id: r.id,
      manychatSubId: r.manychatSubId,
      leadName: snap?.name ?? null,
      prevStage: r.prevStage ?? snap?.pipelineStage ?? null,
      suggestedStage: r.suggestedStage,
      suggestedFlags: (r.suggestedFlags ?? []) as string[],
      suggestedNextAction: r.suggestedNextAction,
      suggestedSummary: r.suggestedSummary,
      reason: r.reason,
      source: r.source,
      quoteTotalDisplay: formatNum(snap?.quoteTotal ?? null),
    };
  });

  const quoteBySid = new Map(snapshots.map((s) => [s.sid, s.quoteTotal ?? 0]));
  inboxItems.sort((a, b) => {
    const aDch = a.suggestedFlags.includes("דחוף") ? 1 : 0;
    const bDch = b.suggestedFlags.includes("דחוף") ? 1 : 0;
    if (aDch !== bDch) return bDch - aDch;
    return (
      (quoteBySid.get(b.manychatSubId.trim()) ?? 0) -
      (quoteBySid.get(a.manychatSubId.trim()) ?? 0)
    );
  });

  // Pipeline view: count by stage (table omitted to keep DOM light).
  const stageCounts: Record<string, number> = {};
  for (const stage of V2_PIPELINE_STAGES) stageCounts[stage] = 0;
  stageCounts["UNCLASSIFIED"] = 0;
  for (const snap of snapshots) {
    const key =
      snap.pipelineStage && V2_PIPELINE_STAGES.includes(snap.pipelineStage)
        ? snap.pipelineStage
        : "UNCLASSIFIED";
    stageCounts[key] = (stageCounts[key] ?? 0) + 1;
  }

  return (
    <div>
      <Page
        title="דאשבורד v2"
        description="כל הצעת סיווג שמחכה לאישור שלך + מבט כללי על ה-Pipeline. אישור = push ל-ManyChat וגם רישום ב-DB."
      />

      <Card title={`Inbox — ${inboxItems.length} ממתינות`}>
        {inboxItems.length === 0 ? (
          <p style={{ fontFamily: fontStack.body, fontSize: size.md, color: colors.inkMuted }}>
            אין הצעות ממתינות. הריץ את ה-skill <code>albadi-classify</code> כדי לקבל הצעות חדשות.
          </p>
        ) : (
          <InboxList items={inboxItems} />
        )}
      </Card>

      <Card title="Pipeline — סיכום">
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: space.lg,
            fontFamily: fontStack.body,
            fontSize: size.sm,
          }}
        >
          {Object.entries(stageCounts).map(([stage, count]) => {
            if (count === 0) return null;
            return (
              <div
                key={stage}
                style={{
                  border: `1px solid ${colors.rule}`,
                  borderRadius: 6,
                  padding: `${space.sm}px ${space.md}px`,
                  minWidth: 110,
                }}
              >
                <div style={{ color: colors.inkMuted, fontSize: size.xs }}>{stage}</div>
                <div
                  style={{
                    fontFamily: fontStack.display,
                    fontSize: size.xl,
                    fontWeight: weight.medium,
                    color: colors.ink,
                  }}
                >
                  {count}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
