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
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">עלות רכישת לקוח מקסימלית</span>
          <input
            type="number"
            min="0"
            step="1"
            value={maxCac}
            onChange={(event) => setMaxCac(event.target.value)}
            placeholder="₪"
            className="w-full rounded-lg border border-border bg-background px-3 py-2"
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-muted-foreground">תקציב יומי לבדיקת מודעות</span>
          <input
            type="number"
            min="0"
            step="1"
            value={dailyBudget}
            onChange={(event) => setDailyBudget(event.target.value)}
            placeholder="₪ ליום"
            className="w-full rounded-lg border border-border bg-background px-3 py-2"
          />
        </label>
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {isPending ? "שומר…" : "שמור יעדים"}
        </button>
      </div>
      {message && <p className="mt-2 text-xs text-muted-foreground">{message}</p>}
    </div>
  );
}
