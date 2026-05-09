"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge, Dot } from "@/components/ui/Badge";
import { colors, fontStack, leading, radius, size, space, weight } from "@/lib/ui/tokens";
import { requestAnalysis } from "@/app/actions/escalation-analysis";

interface EscalationContext {
  currentTag: string | null;
  notes: string | null;
  quoteTotal: number | null;
  daysSinceContact: number | null;
  aiUsed: boolean;
  aiConfidence: number | null;
  ruleMatched: string | null;
}

interface SuggestedReply {
  label: string;
  text: string;
  reasoning: string;
}

interface Escalation {
  id: number;
  leadName: string | null;
  manychatSubId: string;
  reason: string;
  triggerText: string | null;
  createdAt: string;
  context?: EscalationContext;
  analyzeRequested?: boolean;
  analysisSummary?: string | null;
  suggestedReply?: string | null;
  suggestedReplies?: SuggestedReply[] | null;
  analyzedAt?: string | null;
  suggestedTag?: string | null;
  suggestedTagReason?: string | null;
  tagAppliedAt?: string | null;
}

const REASON_HE: Record<string, string> = {
  low_confidence: "Claude לא בטוחה",
  human_request: "ביקש שיחה אישית",
  pricing: "נושא מחיר/הנחה",
  complaint: "תלונה",
  unknown: "לא מוכר / שבור",
};

const REASON_TONE: Record<string, "warning" | "danger" | "accent" | "neutral"> = {
  low_confidence: "warning",
  human_request: "accent",
  pricing: "warning",
  complaint: "danger",
  unknown: "neutral",
};

export function EscalationCard({ escalation }: { escalation: Escalation }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [pickedIndex, setPickedIndex] = useState<number | null>(null);
  const [showFullNotes, setShowFullNotes] = useState(false);
  const [tagBusy, setTagBusy] = useState(false);
  const [tagApplied, setTagApplied] = useState<string | null>(escalation.tagAppliedAt ?? null);
  const [tagError, setTagError] = useState<string | null>(null);
  const [analyzePending, startAnalyze] = useTransition();
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const isPendingAnalysis = !!escalation.analyzeRequested && !escalation.analyzedAt;
  const hasAnalysis = !!escalation.analysisSummary;

  // Poll for analysis result while pending
  useEffect(() => {
    if (!isPendingAnalysis) return;
    const interval = setInterval(() => {
      router.refresh();
    }, 10000);
    return () => clearInterval(interval);
  }, [isPendingAnalysis, router]);

  function onRequestAnalysis() {
    setAnalyzeError(null);
    startAnalyze(async () => {
      const r = await requestAnalysis(escalation.id);
      if (!r.ok) setAnalyzeError(r.error ?? "לא ניתן לבקש ניתוח");
      else router.refresh();
    });
  }

  async function applyTag() {
    if (!escalation.suggestedTag) return;
    setTagBusy(true);
    setTagError(null);
    try {
      const res = await fetch("/api/actions/apply-tag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: escalation.id, tag: escalation.suggestedTag }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "failed");
      }
      setTagApplied(new Date().toISOString());
    } catch (e) {
      setTagError(e instanceof Error ? e.message : "שגיאה בעדכון תג");
    } finally {
      setTagBusy(false);
    }
  }

  async function resolve(action: string, note?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/actions/escalate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: escalation.id,
          action,
          note: note ?? action,
          chosenOptionIndex: pickedIndex,
        }),
      });
      if (!res.ok) throw new Error("failed");
      setDone(true);
    } catch {
      setError("שגיאה בעדכון");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div
        id={`e-${escalation.id}`}
        style={{
          padding: space.lg,
          borderTop: `1px solid ${colors.rule}`,
          color: colors.success,
          fontSize: size.sm,
          fontFamily: fontStack.body,
          fontWeight: weight.medium,
        }}
      >
        נסגר — {escalation.leadName ?? escalation.manychatSubId}
      </div>
    );
  }

  const reasonTone = REASON_TONE[escalation.reason] ?? "neutral";
  const ctx = escalation.context;

  const notesPreviewLimit = 220;
  const notesIsLong = (ctx?.notes?.length ?? 0) > notesPreviewLimit;
  const notesPreview = ctx?.notes && notesIsLong && !showFullNotes
    ? ctx.notes.slice(0, notesPreviewLimit) + "…"
    : ctx?.notes;

  return (
    <article
      id={`e-${escalation.id}`}
      style={{
        padding: `${space.xl}px 0`,
        borderTop: `1px solid ${colors.rule}`,
      }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: space.md,
          marginBottom: space.md,
        }}
      >
        <div style={{ display: "flex", gap: space.sm, alignItems: "center", flexWrap: "wrap" }}>
          <Dot tone={reasonTone} />
          <strong
            style={{
              fontFamily: fontStack.body,
              fontSize: size.lg,
              fontWeight: weight.semibold,
              color: colors.ink,
            }}
          >
            {escalation.leadName ?? escalation.manychatSubId}
          </strong>
          <Badge tone={reasonTone}>{REASON_HE[escalation.reason] ?? escalation.reason}</Badge>
          {ctx?.currentTag && (
            <Badge tone="neutral">{ctx.currentTag.replace(/_/g, " ")}</Badge>
          )}
        </div>
        <span
          style={{
            color: colors.inkSubtle,
            fontSize: size.xs,
            fontFamily: fontStack.body,
            fontVariantNumeric: "tabular-nums",
            flexShrink: 0,
          }}
        >
          {new Date(escalation.createdAt).toLocaleString("he-IL")}
        </span>
      </header>

      {ctx && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: space.md,
            padding: `${space.md}px ${space.lg}px`,
            background: colors.surfaceMuted,
            borderRadius: radius.md,
            marginBottom: space.md,
          }}
        >
          <Fact
            label="ימים ללא מגע"
            value={ctx.daysSinceContact != null ? `${ctx.daysSinceContact}` : "—"}
            tone={ctx.daysSinceContact != null && ctx.daysSinceContact >= 7 ? "danger" : "default"}
          />
          <Fact
            label="הצעה (₪)"
            value={ctx.quoteTotal != null ? ctx.quoteTotal.toLocaleString("he-IL") : "—"}
            tone={ctx.quoteTotal != null && ctx.quoteTotal >= 10000 ? "accent" : "default"}
          />
          <Fact
            label="ביטחון AI"
            value={ctx.aiConfidence != null ? `${Math.round(ctx.aiConfidence * 100)}%` : "—"}
            tone={
              ctx.aiConfidence != null && ctx.aiConfidence < 0.7 ? "warning" : "default"
            }
          />
          <Fact
            label="כלל שזוהה"
            value={ctx.ruleMatched ?? (ctx.aiUsed ? "AI" : "—")}
          />
        </div>
      )}

      {ctx?.notes && (
        <div
          style={{
            marginBottom: space.md,
          }}
        >
          <p style={fieldLabelStyle}>Notes מ-ManyChat</p>
          <div
            style={{
              padding: space.md,
              background: colors.surface,
              border: `1px solid ${colors.rule}`,
              borderRadius: radius.md,
              fontSize: size.sm,
              color: colors.ink,
              lineHeight: leading.normal,
              fontFamily: fontStack.body,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {notesPreview}
            {notesIsLong && (
              <button
                onClick={() => setShowFullNotes((s) => !s)}
                style={{
                  display: "block",
                  marginTop: space.xs,
                  background: "none",
                  border: "none",
                  color: colors.accent,
                  fontSize: size.xs,
                  fontWeight: weight.medium,
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                {showFullNotes ? "הסתר" : "הצג הכל"}
              </button>
            )}
          </div>
        </div>
      )}

      {escalation.triggerText && (
        <div style={{ marginBottom: space.md }}>
          <p style={fieldLabelStyle}>סיבה לספק</p>
          <div
            style={{
              padding: space.md,
              background: colors.warningBg,
              borderInlineStart: `3px solid ${colors.warning}`,
              borderRadius: radius.sm,
              fontSize: size.sm,
              color: colors.ink,
              lineHeight: leading.normal,
              fontFamily: fontStack.body,
            }}
          >
            {escalation.triggerText}
          </div>
        </div>
      )}

      {/* Claude analysis section */}
      <div style={{ marginBottom: space.md }}>
        {hasAnalysis ? (
          <>
            <p style={fieldLabelStyle}>ניתוח Claude</p>
            <div
              style={{
                padding: space.md,
                background: colors.accentSoft,
                borderInlineStart: `3px solid ${colors.accent}`,
                borderRadius: radius.sm,
                fontSize: size.sm,
                color: colors.ink,
                lineHeight: leading.normal,
                fontFamily: fontStack.body,
                whiteSpace: "pre-wrap",
              }}
            >
              {escalation.analysisSummary}
            </div>

            {/* Multi-option suggested replies (preferred) */}
            {escalation.suggestedReplies && escalation.suggestedReplies.length > 0 ? (
              <div style={{ marginTop: space.md }}>
                <p style={fieldLabelStyle}>אופציות תגובה — בחר אחת</p>
                <div style={{ display: "flex", flexDirection: "column", gap: space.sm }}>
                  {escalation.suggestedReplies.map((opt, idx) => (
                    <ReplyOption
                      key={idx}
                      option={opt}
                      isSelected={pickedIndex === idx}
                      onPick={() => {
                        setDraft(opt.text);
                        setPickedIndex(idx);
                      }}
                    />
                  ))}
                </div>
              </div>
            ) : escalation.suggestedReply ? (
              // Backward compat: single suggested_reply
              <div style={{ marginTop: space.md }}>
                <p style={fieldLabelStyle}>תגובה מוצעת</p>
                <div
                  style={{
                    padding: space.md,
                    background: colors.surface,
                    border: `1px solid ${colors.rule}`,
                    borderRadius: radius.md,
                    fontSize: size.sm,
                    color: colors.ink,
                    lineHeight: leading.normal,
                    fontFamily: fontStack.body,
                    fontStyle: "italic",
                  }}
                >
                  {escalation.suggestedReply}
                  <button
                    onClick={() => setDraft(escalation.suggestedReply!)}
                    style={{
                      display: "block",
                      marginTop: space.sm,
                      background: "none",
                      border: `1px solid ${colors.accent}`,
                      color: colors.accent,
                      fontSize: size.xs,
                      fontWeight: weight.medium,
                      padding: `${space.xs}px ${space.md}px`,
                      borderRadius: radius.sm,
                      cursor: "pointer",
                      fontFamily: fontStack.body,
                    }}
                  >
                    השתמש בתגובה הזו
                  </button>
                </div>
              </div>
            ) : null}

            {escalation.suggestedTag && (
              <div style={{ marginTop: space.md }}>
                <p style={fieldLabelStyle}>הצעה לשינוי תג</p>
                <div
                  style={{
                    padding: space.md,
                    background: colors.surface,
                    border: `1px solid ${colors.rule}`,
                    borderRadius: radius.md,
                    fontFamily: fontStack.body,
                    fontSize: size.sm,
                    color: colors.ink,
                    lineHeight: leading.normal,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: space.sm, flexWrap: "wrap" }}>
                    <span style={{ color: colors.inkMuted }}>סמן כ:</span>
                    <strong style={{ fontWeight: weight.semibold }}>{escalation.suggestedTag}</strong>
                  </div>
                  {escalation.suggestedTagReason && (
                    <div
                      style={{
                        marginTop: space.xs,
                        fontSize: size.xs,
                        color: colors.inkMuted,
                      }}
                    >
                      {escalation.suggestedTagReason}
                    </div>
                  )}
                  <div style={{ marginTop: space.sm }}>
                    {tagApplied ? (
                      <span style={{ color: colors.success, fontWeight: weight.medium, fontSize: size.xs }}>
                        ✓ תג הוחל ב-{new Date(tagApplied).toLocaleString("he-IL")}
                      </span>
                    ) : (
                      <button
                        onClick={applyTag}
                        disabled={tagBusy}
                        style={{
                          background: colors.accent,
                          color: colors.surface,
                          border: "none",
                          fontSize: size.xs,
                          fontWeight: weight.medium,
                          padding: `${space.xs}px ${space.md}px`,
                          borderRadius: radius.sm,
                          cursor: tagBusy ? "wait" : "pointer",
                          fontFamily: fontStack.body,
                          opacity: tagBusy ? 0.6 : 1,
                        }}
                      >
                        {tagBusy ? "מחיל..." : "אשר תג"}
                      </button>
                    )}
                    {tagError && (
                      <span style={{ marginInlineStart: space.sm, color: colors.danger, fontSize: size.xs }}>
                        {tagError}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        ) : isPendingAnalysis ? (
          <div
            style={{
              padding: space.md,
              background: colors.warningBg,
              borderInlineStart: `3px solid ${colors.warning}`,
              borderRadius: radius.sm,
              fontSize: size.sm,
              color: colors.ink,
              fontFamily: fontStack.body,
              lineHeight: leading.normal,
            }}
          >
            <strong style={{ fontWeight: weight.semibold }}>ממתין לניתוח.</strong>{" "}
            פתח Claude Code על המחשב והרץ את המשימה{" "}
            <code
              style={{
                background: colors.surface,
                border: `1px solid ${colors.rule}`,
                borderRadius: 4,
                padding: "1px 6px",
                fontSize: size.xs,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              }}
            >
              albadi-escalation-analysis
            </code>
            . התוצאה תופיע כאן תוך 1–3 דקות.
          </div>
        ) : (
          <div>
            <Button
              variant="secondary"
              size="sm"
              onClick={onRequestAnalysis}
              pending={analyzePending}
              pendingText="שולח..."
            >
              נתח עם Claude
            </Button>
            {analyzeError && (
              <span
                style={{
                  marginInlineStart: space.sm,
                  color: colors.danger,
                  fontSize: size.sm,
                  fontFamily: fontStack.body,
                }}
              >
                {analyzeError}
              </span>
            )}
          </div>
        )}
      </div>

      <div style={{ marginBottom: space.md }}>
        <label htmlFor={`draft-${escalation.id}`} style={fieldLabelStyle}>
          טיוטת תגובה
        </label>
        <textarea
          id={`draft-${escalation.id}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="כתוב כאן את התגובה שתישלח ללקוח..."
          rows={3}
          style={{
            width: "100%",
            padding: space.md,
            borderRadius: radius.md,
            border: `1px solid ${colors.rule}`,
            fontFamily: fontStack.body,
            fontSize: size.md,
            color: colors.ink,
            background: colors.surface,
            resize: "vertical",
            outline: "none",
            lineHeight: leading.normal,
          }}
        />
      </div>

      <div style={{ display: "flex", gap: space.sm, flexWrap: "wrap" }}>
        <Button
          variant="primary"
          onClick={() => resolve("sent", `נשלח: ${draft.slice(0, 100)}`)}
          disabled={busy || !draft.trim()}
          pending={busy}
          pendingText="שולח..."
        >
          אשר ושלח
        </Button>
        <Button variant="secondary" onClick={() => resolve("dismissed")} disabled={busy}>
          דחה
        </Button>
        <Button variant="ghost" onClick={() => resolve("manual", "אטפל ידנית")} disabled={busy}>
          אטפל ידנית
        </Button>
      </div>

      {error && (
        <p
          style={{
            color: colors.danger,
            fontSize: size.sm,
            marginTop: space.sm,
            marginBottom: 0,
            fontFamily: fontStack.body,
          }}
        >
          {error}
        </p>
      )}
    </article>
  );
}

function ReplyOption({
  option,
  isSelected,
  onPick,
}: {
  option: SuggestedReply;
  isSelected: boolean;
  onPick: () => void;
}) {
  return (
    <div
      style={{
        padding: space.md,
        background: isSelected ? colors.accentSoft : colors.surface,
        border: `1px solid ${isSelected ? colors.accent : colors.rule}`,
        borderRadius: radius.md,
        fontFamily: fontStack.body,
        transition: "background 150ms, border-color 150ms",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: space.sm,
          gap: space.sm,
        }}
      >
        <span
          style={{
            fontSize: size.xs,
            fontWeight: weight.semibold,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: colors.accent,
          }}
        >
          {option.label}
        </span>
        <button
          onClick={onPick}
          style={{
            background: isSelected ? colors.accent : "transparent",
            color: isSelected ? colors.surface : colors.accent,
            border: `1px solid ${colors.accent}`,
            fontSize: size.xs,
            fontWeight: weight.medium,
            padding: `${space.xs}px ${space.md}px`,
            borderRadius: radius.sm,
            cursor: "pointer",
            fontFamily: fontStack.body,
          }}
        >
          {isSelected ? "✓ נבחרה" : "השתמש בזו"}
        </button>
      </div>
      <div
        style={{
          fontSize: size.sm,
          color: colors.ink,
          lineHeight: leading.normal,
          marginBottom: option.reasoning ? space.sm : 0,
          whiteSpace: "pre-wrap",
        }}
      >
        {option.text}
      </div>
      {option.reasoning && (
        <div
          style={{
            fontSize: size.xs,
            color: colors.inkMuted,
            lineHeight: leading.normal,
            paddingTop: space.xs,
            borderTop: `1px solid ${colors.ruleSoft}`,
          }}
        >
          <span style={{ fontWeight: weight.medium }}>למה: </span>
          {option.reasoning}
        </div>
      )}
    </div>
  );
}

function Fact({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "danger" | "warning" | "accent";
}) {
  const toneColor =
    tone === "danger"
      ? colors.danger
      : tone === "warning"
      ? colors.warning
      : tone === "accent"
      ? colors.accent
      : colors.ink;
  return (
    <div>
      <p style={fieldLabelStyle}>{label}</p>
      <p
        style={{
          fontFamily: fontStack.body,
          fontSize: size.md,
          fontWeight: weight.semibold,
          color: toneColor,
          fontVariantNumeric: "tabular-nums",
          margin: 0,
          marginTop: 2,
        }}
      >
        {value}
      </p>
    </div>
  );
}

const fieldLabelStyle: React.CSSProperties = {
  fontFamily: fontStack.body,
  fontSize: size.xs,
  fontWeight: weight.medium,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: colors.inkMuted,
  margin: 0,
  marginBottom: space.xs,
};
