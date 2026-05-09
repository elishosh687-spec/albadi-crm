import { db } from "@/lib/db";
import { escalations, decisions } from "@/drizzle/schema";
import { desc, eq, isNull, isNotNull } from "drizzle-orm";
import { EscalationCard } from "./EscalationCard";
import { BulkAnalyzeButton } from "./BulkAnalyzeButton";
import { Page } from "@/components/ui/Page";
import { Card } from "@/components/ui/Card";
import { colors, fontStack, leading, size, space, weight } from "@/lib/ui/tokens";

export const dynamic = "force-dynamic";

interface DecisionInput {
  notes?: string | null;
  currentTag?: string | null;
  daysSinceContact?: number | null;
  quoteTotal?: number | null;
}

export default async function EscalationsPage() {
  const [open, closed] = await Promise.all([
    db
      .select({
        id: escalations.id,
        manychatSubId: escalations.manychatSubId,
        leadName: escalations.leadName,
        reason: escalations.reason,
        triggerText: escalations.triggerText,
        createdAt: escalations.createdAt,
        decisionId: escalations.decisionId,
        analyzeRequested: escalations.analyzeRequested,
        analysisSummary: escalations.analysisSummary,
        suggestedReply: escalations.suggestedReply,
        suggestedReplies: escalations.suggestedReplies,
        analyzedAt: escalations.analyzedAt,
        aiUsed: decisions.aiUsed,
        aiConfidence: decisions.aiConfidence,
        ruleMatched: decisions.ruleMatched,
        prevTag: decisions.prevTag,
        inputMessages: decisions.inputMessages,
      })
      .from(escalations)
      .leftJoin(decisions, eq(escalations.decisionId, decisions.id))
      .where(isNull(escalations.resolvedAt))
      .orderBy(desc(escalations.createdAt)),
    db
      .select()
      .from(escalations)
      .where(isNotNull(escalations.resolvedAt))
      .orderBy(desc(escalations.resolvedAt))
      .limit(20),
  ]);

  const pendingAnalyses = open.filter((e) => e.analyzeRequested && !e.analyzedAt).length;

  return (
    <div>
      <Page
        title="הסלמות"
        description="לידים שהבוט לא יכול לטפל בהם לבד — נושאי מחיר, בקשות לשיחה, או כל מקרה שדורש שיקול דעת אנושי."
        actions={<BulkAnalyzeButton openCount={open.length} />}
      />

      {pendingAnalyses > 0 && (
        <div
          style={{
            background: colors.warningBg,
            borderInlineStart: `3px solid ${colors.warning}`,
            borderRadius: 6,
            padding: `${space.md}px ${space.lg}px`,
            marginBottom: space.xl,
            fontFamily: fontStack.body,
            fontSize: size.sm,
            color: colors.ink,
            lineHeight: leading.normal,
          }}
        >
          <strong style={{ fontWeight: weight.semibold, marginInlineEnd: space.xs }}>
            {pendingAnalyses} הסלמות מחכות לניתוח של Claude.
          </strong>
          כדי לקבל summary ואופציות תגובה, פתח <strong>Claude Code</strong> על המחשב שלך
          ולחץ &quot;Run now&quot; על המשימה <code style={codeStyle}>albadi-escalation-analysis</code>.
          התוצאה תופיע כאן תוך 1–3 דקות.
        </div>
      )}

      <Card title="פתוחות" eyebrow={`${open.length} ממתינות`}>
        {open.length === 0 ? (
          <p style={emptyStyle}>אין הסלמות פתוחות.</p>
        ) : (
          open.map((e) => {
            const input = (e.inputMessages ?? {}) as DecisionInput;
            return (
              <EscalationCard
                key={e.id}
                escalation={{
                  id: e.id,
                  leadName: e.leadName ?? null,
                  manychatSubId: e.manychatSubId,
                  reason: e.reason,
                  triggerText: e.triggerText ?? null,
                  createdAt: e.createdAt.toISOString(),
                  analyzeRequested: e.analyzeRequested,
                  analysisSummary: e.analysisSummary ?? null,
                  suggestedReply: e.suggestedReply ?? null,
                  suggestedReplies: e.suggestedReplies ?? null,
                  analyzedAt: e.analyzedAt ? e.analyzedAt.toISOString() : null,
                  context: {
                    currentTag: input.currentTag ?? null,
                    notes: input.notes ?? null,
                    quoteTotal: input.quoteTotal ?? null,
                    daysSinceContact: input.daysSinceContact ?? null,
                    aiUsed: e.aiUsed ?? false,
                    aiConfidence: e.aiConfidence ? Number(e.aiConfidence) : null,
                    ruleMatched: e.ruleMatched ?? null,
                  },
                }}
              />
            );
          })
        )}
      </Card>

      <Card title="סגורות" eyebrow={`אחרונות ${closed.length}`}>
        {closed.length === 0 ? (
          <p style={emptyStyle}>אין הסלמות סגורות עדיין.</p>
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {closed.map((e, i) => (
              <li
                key={e.id}
                style={{
                  borderTop: i === 0 ? "none" : `1px solid ${colors.ruleSoft}`,
                  padding: `${space.md}px 0`,
                  display: "flex",
                  justifyContent: "space-between",
                  gap: space.lg,
                  fontSize: size.sm,
                  color: colors.inkMuted,
                  lineHeight: leading.normal,
                  fontFamily: fontStack.body,
                }}
              >
                <div>
                  <strong style={{ color: colors.ink, fontWeight: weight.medium }}>
                    {e.leadName ?? e.manychatSubId}
                  </strong>{" "}
                  — {e.reason} — {e.resolutionNote ?? "טופל"}
                </div>
                {e.resolvedAt && (
                  <span style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                    {new Date(e.resolvedAt).toLocaleString("he-IL")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

const emptyStyle: React.CSSProperties = {
  fontFamily: fontStack.body,
  fontSize: size.md,
  color: colors.inkMuted,
  margin: 0,
  padding: `${space.lg}px 0`,
};

const codeStyle: React.CSSProperties = {
  background: colors.surface,
  border: `1px solid ${colors.rule}`,
  borderRadius: 4,
  padding: "1px 6px",
  fontSize: size.xs,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  color: colors.ink,
};
