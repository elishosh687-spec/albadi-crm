"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { colors, fontStack, leading, size, space, weight } from "@/lib/ui/tokens";
import { approveSuggestion, rejectSuggestion } from "@/app/actions/v2";

export interface InboxItem {
  id: number;
  manychatSubId: string;
  leadName: string | null;
  prevStage: string | null;
  suggestedStage: string;
  suggestedFlags: string[];
  suggestedNextAction: string | null;
  suggestedSummary: string | null;
  reason: string;
  source: string;
  quoteTotalDisplay: string | null;
  notes: string | null;
}

const FLAG_TONES: Record<string, "danger" | "warning" | "info" | "accent" | "neutral"> = {
  "דחוף": "danger",
  "עסקה_גדולה": "accent",
  "ביקש_שיחה": "warning",
  "אחרי_החג": "info",
  "מועדף": "accent",
};

export function InboxRow({
  item,
  checked,
  onToggle,
}: {
  item: InboxItem;
  checked: boolean;
  onToggle: (next: boolean) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function onApprove() {
    start(async () => {
      const r = await approveSuggestion({ suggestionId: item.id });
      if (r.ok) router.refresh();
      else if (typeof window !== "undefined") window.alert(r.error ?? "כשל");
    });
  }

  function onReject() {
    if (typeof window !== "undefined") {
      if (!window.confirm("לדחות את ההצעה? הליד ינותח מחדש בריצה הבאה.")) return;
    }
    start(async () => {
      const r = await rejectSuggestion(item.id);
      if (r.ok) router.refresh();
      else if (typeof window !== "undefined") window.alert(r.error ?? "כשל");
    });
  }

  const cleanSid = item.manychatSubId.trim();

  return (
    <div
      style={{
        border: `1px solid ${colors.rule}`,
        borderRadius: 8,
        padding: space.lg,
        marginBottom: space.lg,
        background: colors.surface,
        display: "flex",
        gap: space.lg,
        alignItems: "flex-start",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onToggle(e.target.checked)}
        style={{ marginTop: 6 }}
      />
      <div style={{ flex: 1 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: space.md,
            marginBottom: space.sm,
            flexWrap: "wrap",
          }}
        >
          <Link
            href={`/dashboard/v2/lead/${encodeURIComponent(cleanSid)}`}
            style={{
              fontFamily: fontStack.display,
              fontSize: size.lg,
              fontWeight: weight.medium,
              color: colors.ink,
              textDecoration: "none",
            }}
          >
            {item.leadName ?? cleanSid}
          </Link>
          <div style={{ display: "flex", gap: space.sm, flexWrap: "wrap", alignItems: "baseline" }}>
            {item.quoteTotalDisplay && (
              <span
                style={{
                  fontFamily: fontStack.body,
                  fontSize: size.md,
                  fontWeight: weight.medium,
                  color: colors.ink,
                }}
              >
                {item.quoteTotalDisplay} ₪
              </span>
            )}
            {item.suggestedFlags.map((f) => (
              <Badge key={f} tone={FLAG_TONES[f] ?? "neutral"}>
                {f}
              </Badge>
            ))}
          </div>
        </div>

        <div
          style={{
            fontFamily: fontStack.body,
            fontSize: size.sm,
            color: colors.inkMuted,
            marginBottom: space.sm,
          }}
        >
          <span style={{ fontWeight: weight.medium, color: colors.ink }}>
            {item.prevStage ?? "—"}
          </span>{" → "}
          <span style={{ fontWeight: weight.semibold, color: colors.accent }}>
            {item.suggestedStage}
          </span>
        </div>

        {item.suggestedSummary && (
          <div
            style={{
              fontFamily: fontStack.body,
              fontSize: size.sm,
              color: colors.ink,
              marginBottom: space.xs,
              fontStyle: "italic",
            }}
          >
            {item.suggestedSummary}
          </div>
        )}

        <div
          style={{
            fontFamily: fontStack.body,
            fontSize: size.sm,
            color: colors.inkMuted,
            lineHeight: leading.normal,
            marginBottom: space.sm,
          }}
        >
          {item.reason}
        </div>

        {item.suggestedNextAction && (
          <div
            style={{
              fontFamily: fontStack.body,
              fontSize: size.sm,
              color: colors.success,
              marginBottom: space.md,
            }}
          >
            <span style={{ fontWeight: weight.medium }}>Next:</span> {item.suggestedNextAction}
          </div>
        )}

        <div style={{ display: "flex", gap: space.sm, alignItems: "center", flexWrap: "wrap" }}>
          <Button size="sm" variant="primary" onClick={onApprove} pending={pending}>
            אישור
          </Button>
          <Button size="sm" variant="ghost" onClick={onReject} disabled={pending}>
            דחה
          </Button>
          <Link
            href={`/dashboard/v2/lead/${encodeURIComponent(cleanSid)}`}
            style={{
              fontFamily: fontStack.body,
              fontSize: size.sm,
              color: colors.accent,
              marginInlineStart: space.sm,
            }}
          >
            פתח מסך מלא (notes + override) ↗
          </Link>
        </div>
      </div>
    </div>
  );
}
