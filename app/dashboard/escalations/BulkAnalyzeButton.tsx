"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { colors, fontStack, size, space } from "@/lib/ui/tokens";
import { requestAllAnalyses } from "@/app/actions/escalation-analysis";

export function BulkAnalyzeButton({ openCount }: { openCount: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; marked?: number; error?: string } | null>(null);

  if (openCount === 0) return null;

  function onClick() {
    setResult(null);
    start(async () => {
      const r = await requestAllAnalyses();
      setResult(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: space.md }}>
      <Button variant="secondary" size="sm" onClick={onClick} pending={pending} pendingText="מסמן...">
        נתח את כל הפתוחות עם Claude
      </Button>
      {result?.ok && result.marked !== undefined && (
        <span style={{ fontFamily: fontStack.body, fontSize: size.sm, color: colors.success }}>
          {result.marked === 0
            ? "כל ההסלמות כבר מסומנות / מנותחות"
            : `סומנו ${result.marked} להסלמות לניתוח. הפעל את ה-task מקומית.`}
        </span>
      )}
      {result && !result.ok && (
        <span style={{ fontFamily: fontStack.body, fontSize: size.sm, color: colors.danger }}>
          שגיאה: {result.error}
        </span>
      )}
    </div>
  );
}
