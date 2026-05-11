"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { colors, fontStack, size, space } from "@/lib/ui/tokens";
import { approveSuggestion, rejectSuggestion } from "@/app/actions/v2";
import {
  V2_PIPELINE_STAGES,
  type V2PipelineStage,
} from "@/lib/manychat/config";

interface Props {
  suggestionId: number;
  suggestedStage: string;
}

export function LeadActions({ suggestionId, suggestedStage }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [overrideStage, setOverrideStage] = useState<string>("");

  function onApprove() {
    start(async () => {
      const r = await approveSuggestion({ suggestionId });
      if (r.ok) router.refresh();
      else if (typeof window !== "undefined") window.alert(r.error ?? "כשל");
    });
  }

  function onOverride() {
    if (!overrideStage) return;
    start(async () => {
      const r = await approveSuggestion({
        suggestionId,
        stage: overrideStage as V2PipelineStage,
        overrideReason: `Manual override from ${suggestedStage} to ${overrideStage}`,
      });
      if (r.ok) router.refresh();
      else if (typeof window !== "undefined") window.alert(r.error ?? "כשל");
    });
  }

  function onReject() {
    if (typeof window !== "undefined") {
      if (!window.confirm("לדחות את ההצעה לחלוטין? הליד ינותח מחדש בריצה הבאה.")) return;
    }
    start(async () => {
      const r = await rejectSuggestion(suggestionId);
      if (r.ok) router.refresh();
      else if (typeof window !== "undefined") window.alert(r.error ?? "כשל");
    });
  }

  return (
    <div style={{ display: "flex", gap: space.sm, alignItems: "center", flexWrap: "wrap" }}>
      <Button size="md" variant="primary" onClick={onApprove} pending={pending}>
        אישור ({suggestedStage})
      </Button>
      <select
        value={overrideStage}
        onChange={(e) => setOverrideStage(e.target.value)}
        disabled={pending}
        style={{
          fontFamily: fontStack.body,
          fontSize: size.sm,
          padding: `${space.sm}px ${space.md}px`,
          border: `1px solid ${colors.rule}`,
          borderRadius: 6,
          background: colors.surface,
          color: colors.ink,
        }}
      >
        <option value="">— Override stage —</option>
        {V2_PIPELINE_STAGES.filter((s) => s !== suggestedStage).map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <Button
        size="md"
        variant="secondary"
        onClick={onOverride}
        disabled={!overrideStage || pending}
      >
        החל override
      </Button>
      <Button size="md" variant="ghost" onClick={onReject} disabled={pending}>
        דחה
      </Button>
    </div>
  );
}
