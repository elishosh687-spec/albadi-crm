"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Badge, Dot } from "@/components/ui/Badge";
import { colors, fontStack, leading, radius, size, space, weight } from "@/lib/ui/tokens";

interface Escalation {
  id: number;
  leadName: string | null;
  manychatSubId: string;
  reason: string;
  triggerText: string | null;
  createdAt: string;
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
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  async function resolve(action: string, note?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/actions/escalate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: escalation.id, action, note: note ?? action }),
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

      {escalation.triggerText && (
        <div
          style={{
            background: colors.surfaceMuted,
            padding: space.md,
            borderRadius: radius.md,
            fontSize: size.sm,
            color: colors.ink,
            lineHeight: leading.normal,
            marginBottom: space.lg,
            fontFamily: fontStack.body,
          }}
        >
          {escalation.triggerText}
        </div>
      )}

      <div style={{ marginBottom: space.md }}>
        <label
          style={{
            display: "block",
            fontFamily: fontStack.body,
            fontSize: size.xs,
            fontWeight: weight.medium,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: colors.inkMuted,
            marginBottom: space.xs,
          }}
        >
          טיוטת תגובה
        </label>
        <textarea
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
