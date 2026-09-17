"use server";

// Canonical GHL-widget action; both routes invalidate after a save.

import { revalidatePath } from "next/cache";
import { saveSalesTargets } from "@/lib/analytics/targets";

export async function saveSalesTargetsAction(input: {
  maxCustomerAcquisitionCostIls: number | null;
  dailyAdTestBudgetIls: number | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const value of Object.values(input)) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      return { ok: false, error: "יש להזין מספר חיובי או להשאיר ריק" };
    }
  }
  try {
    await saveSalesTargets(input);
    revalidatePath("/dashboard/v3/analytics");
    revalidatePath("/widget/analytics");
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "שמירת היעדים נכשלה",
    };
  }
}
