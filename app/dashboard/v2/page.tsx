import { db } from "@/lib/db";
import { pipelineSuggestions, leads } from "@/drizzle/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Page } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { colors, fontStack, leading, size, space, weight } from "@/lib/ui/tokens";
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

const FLAG_TONES: Record<string, "danger" | "warning" | "info" | "accent" | "neutral"> = {
  "דחוף": "danger",
  "עסקה_גדולה": "accent",
  "ביקש_שיחה": "warning",
  "אחרי_החג": "info",
  "מועדף": "accent",
};

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

  // Pipeline view: group all snapshots by stage
  const groups: Record<string, LeadSnapshot[]> = {};
  for (const stage of V2_PIPELINE_STAGES) groups[stage] = [];
  groups["UNCLASSIFIED"] = [];
  for (const snap of snapshots) {
    const key = snap.pipelineStage && V2_PIPELINE_STAGES.includes(snap.pipelineStage)
      ? snap.pipelineStage
      : "UNCLASSIFIED";
    groups[key].push(snap);
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

      <Card title="Pipeline — מצב כל הלידים">
        {Object.entries(groups).map(([stage, list]) => {
          if (list.length === 0) return null;
          return (
            <details
              key={stage}
              open={stage !== "UNCLASSIFIED"}
              style={{
                marginBottom: space.lg,
                paddingBottom: space.md,
                borderBottom: `1px solid ${colors.ruleSoft}`,
              }}
            >
              <summary
                style={{
                  cursor: "pointer",
                  fontFamily: fontStack.display,
                  fontSize: size.lg,
                  fontWeight: weight.medium,
                  color: colors.ink,
                  marginBottom: space.sm,
                }}
              >
                {stage}{" "}
                <span style={{ color: colors.inkMuted, fontWeight: weight.regular, fontSize: size.sm }}>
                  ({list.length})
                </span>
              </summary>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontFamily: fontStack.body,
                  fontSize: size.sm,
                }}
              >
                <thead>
                  <tr style={{ textAlign: "right", color: colors.inkMuted }}>
                    <th style={{ padding: `${space.xs}px ${space.sm}px` }}>שם</th>
                    <th style={{ padding: `${space.xs}px ${space.sm}px` }}>Quote</th>
                    <th style={{ padding: `${space.xs}px ${space.sm}px` }}>Flags</th>
                    <th style={{ padding: `${space.xs}px ${space.sm}px` }}>אינטרקציה אחרונה</th>
                    <th style={{ padding: `${space.xs}px ${space.sm}px` }}>תור?</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((s) => (
                    <tr key={s.sid} style={{ borderTop: `1px solid ${colors.ruleSoft}` }}>
                      <td style={{ padding: `${space.xs}px ${space.sm}px`, color: colors.ink }}>
                        {s.name ?? s.sid}
                      </td>
                      <td style={{ padding: `${space.xs}px ${space.sm}px`, color: colors.ink }}>
                        {s.quoteTotal != null ? `${formatNum(s.quoteTotal)} ₪` : "—"}
                      </td>
                      <td style={{ padding: `${space.xs}px ${space.sm}px` }}>
                        <span style={{ display: "inline-flex", gap: space.xs, flexWrap: "wrap" }}>
                          {s.flags.map((f) => (
                            <Badge key={f} tone={FLAG_TONES[f] ?? "neutral"}>
                              {f}
                            </Badge>
                          ))}
                        </span>
                      </td>
                      <td style={{ padding: `${space.xs}px ${space.sm}px`, color: colors.inkMuted }}>
                        {s.lastInteraction ? s.lastInteraction.slice(0, 16).replace("T", " ") : "—"}
                      </td>
                      <td style={{ padding: `${space.xs}px ${space.sm}px`, color: colors.inkMuted }}>
                        {pendingSids.has(s.sid) ? "•" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          );
        })}
      </Card>
    </div>
  );
}
