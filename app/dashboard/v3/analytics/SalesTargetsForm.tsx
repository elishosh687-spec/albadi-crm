"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSalesTargetsAction } from "./actions";

function parseOptionalNumber(value: string): number | null {
  if (!value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function SalesTargetsForm({
  maxCustomerAcquisitionCostIls,
  dailyAdTestBudgetIls,
}: {
  maxCustomerAcquisitionCostIls: number | null;
  dailyAdTestBudgetIls: number | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [maxCac, setMaxCac] = useState(
    maxCustomerAcquisitionCostIls?.toString() ?? ""
  );
  const [dailyBudget, setDailyBudget] = useState(
    dailyAdTestBudgetIls?.toString() ?? ""
  );
  const [message, setMessage] = useState<string | null>(null);

  const save = () => {
    startTransition(async () => {
      const result = await saveSalesTargetsAction({
        maxCustomerAcquisitionCostIls: parseOptionalNumber(maxCac),
        dailyAdTestBudgetIls: parseOptionalNumber(dailyBudget),
      });
      setMessage(result.ok ? "נשמר" : result.error);
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className="rounded-xl border border-border bg-muted/15 p-5">
      <div className="mb-4">
        <h3 className="text-sm font-semibold">יעדי פרסום</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          שמור את הגבולות העסקיים כדי להשוות אליהם את ביצועי הקמפיינים.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm">
          <span className="text-xs text-muted-foreground">עלות רכישת לקוח מקסימלית</span>
          <input
            type="number"
            min="0"
            step="1"
            value={maxCac}
            onChange={(event) => setMaxCac(event.target.value)}
            placeholder="₪"
            className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-base outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
        <label className="space-y-2 text-sm">
          <span className="text-xs text-muted-foreground">תקציב יומי לבדיקת מודעות</span>
          <input
            type="number"
            min="0"
            step="1"
            value={dailyBudget}
            onChange={(event) => setDailyBudget(event.target.value)}
            placeholder="₪ ליום"
            className="min-h-11 w-full rounded-lg border border-border bg-background px-3 py-2 text-base outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </label>
      </div>
      <div className="mt-4 flex min-h-11 items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
          {message ?? "אפשר לעדכן בכל עת"}
        </p>
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="min-h-11 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-transform active:translate-y-px disabled:opacity-50"
        >
          {isPending ? "שומר…" : "שמור יעדים"}
        </button>
      </div>
    </div>
  );
}
