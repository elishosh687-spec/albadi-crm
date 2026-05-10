"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { colors, fontStack, leading, size, space, weight } from "@/lib/ui/tokens";
import {
  V2_FLAG_NAMES,
  V2_PIPELINE_STAGES,
  type V2FlagName,
  type V2PipelineStage,
} from "@/lib/manychat/config";
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
  quoteTotal: number | null;
  createdAt: Date;
}

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
  const [editing, setEditing] = useState(false);
  const [stage, setStage] = useState<V2PipelineStage>(
    item.suggestedStage as V2PipelineStage
  );
  const [flags, setFlags] = useState<V2FlagName[]>(
    (item.suggestedFlags as V2FlagName[]) ?? []
  );
  const [overrideReason, setOverrideReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  const flagsToTone: Record<string, "danger" | "warning" | "info" | "accent" | "neutral"> = {
    "דחוף": "danger",
    "עסקה_גדולה": "accent",
    "ביקש_שיחה": "warning",
    "אחרי_החג": "info",
    "מועדף": "accent",
  };

  function onApprove() {
    setError(null);
    start(async () => {
      const r = await approveSuggestion({ suggestionId: item.id });
      if (!r.ok) setError(r.error ?? "כשל");
      else router.refresh();
    });
  }

  function onSaveOverride() {
    setError(null);
    start(async () => {
      const r = await approveSuggestion({
        suggestionId: item.id,
        stage,
        flags,
        overrideReason: overrideReason || undefined,
      });
      if (!r.ok) setError(r.error ?? "כשל");
      else {
        setEditing(false);
        router.refresh();
      }
    });
  }

  function onReject() {
    if (!confirm("לדחות את ההצעה? הליד ינותח מחדש בריצה הבאה.")) return;
    setError(null);
    start(async () => {
      const r = await rejectSuggestion(item.id, overrideReason || undefined);
      if (!r.ok) setError(r.error ?? "כשל");
      else router.refresh();
    });
  }

  function toggleFlag(name: V2FlagName) {
    setFlags((prev) =>
      prev.includes(name) ? prev.filter((f) => f !== name) : [...prev, name]
    );
  }

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
        style={{ marginTop: 6, transform: "scale(1.2)" }}
      />
      <div style={{ flex: 1 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: space.md,
            marginBottom: space.sm,
          }}
        >
          <div
            style={{
              fontFamily: fontStack.display,
              fontSize: size.lg,
              fontWeight: weight.medium,
              color: colors.ink,
            }}
          >
            {item.leadName ?? item.manychatSubId}
          </div>
          <div style={{ display: "flex", gap: space.sm, flexWrap: "wrap", alignItems: "baseline" }}>
            {item.quoteTotal != null && (
              <span
                style={{
                  fontFamily: fontStack.body,
                  fontSize: size.md,
                  fontWeight: weight.medium,
                  color: colors.ink,
                }}
              >
                {item.quoteTotal.toLocaleString("he-IL")} ₪
              </span>
            )}
            {(item.suggestedFlags ?? []).map((f) => (
              <Badge key={f} tone={flagsToTone[f] ?? "neutral"}>
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
          </span>{" "}
          →{" "}
          <span style={{ fontWeight: weight.semibold, color: colors.accent }}>
            {item.suggestedStage}
          </span>
          <span style={{ marginInlineStart: space.md, color: colors.inkSubtle }}>
            {item.source}
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
          <span style={{ fontWeight: weight.medium, color: colors.ink }}>
            Why:
          </span>{" "}
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
            <span style={{ fontWeight: weight.medium }}>Next:</span>{" "}
            {item.suggestedNextAction}
          </div>
        )}

        {error && (
          <div
            style={{
              fontFamily: fontStack.body,
              fontSize: size.sm,
              color: colors.danger,
              marginBottom: space.sm,
            }}
          >
            {error}
          </div>
        )}

        {editing ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: space.sm,
              padding: space.md,
              background: colors.surfaceMuted,
              borderRadius: 6,
              marginBottom: space.sm,
            }}
          >
            <label style={{ fontFamily: fontStack.body, fontSize: size.sm }}>
              <div style={{ marginBottom: space.xs }}>Stage:</div>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value as V2PipelineStage)}
                style={{
                  fontFamily: fontStack.body,
                  fontSize: size.sm,
                  padding: `${space.xs}px ${space.sm}px`,
                  border: `1px solid ${colors.rule}`,
                  borderRadius: 4,
                  background: colors.surface,
                }}
              >
                {V2_PIPELINE_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ fontFamily: fontStack.body, fontSize: size.sm }}>
              <div style={{ marginBottom: space.xs }}>Flags:</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: space.sm }}>
                {V2_FLAG_NAMES.map((name) => (
                  <label key={name} style={{ display: "flex", alignItems: "center", gap: space.xs }}>
                    <input
                      type="checkbox"
                      checked={flags.includes(name)}
                      onChange={() => toggleFlag(name)}
                    />
                    {name}
                  </label>
                ))}
              </div>
            </div>
            <label style={{ fontFamily: fontStack.body, fontSize: size.sm }}>
              <div style={{ marginBottom: space.xs }}>סיבה לשינוי (אופציונלי):</div>
              <input
                type="text"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="למה שינית את ההצעה"
                style={{
                  fontFamily: fontStack.body,
                  fontSize: size.sm,
                  padding: `${space.xs}px ${space.sm}px`,
                  border: `1px solid ${colors.rule}`,
                  borderRadius: 4,
                  width: "100%",
                  background: colors.surface,
                }}
              />
            </label>
            <div style={{ display: "flex", gap: space.sm }}>
              <Button size="sm" variant="primary" onClick={onSaveOverride} pending={pending}>
                שמור Override
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
                ביטול
              </Button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", gap: space.sm }}>
            <Button size="sm" variant="primary" onClick={onApprove} pending={pending}>
              אישור
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)} disabled={pending}>
              שינוי
            </Button>
            <Button size="sm" variant="ghost" onClick={onReject} disabled={pending}>
              דחה
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
