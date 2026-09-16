import { appConfig } from "@/drizzle/schema";
import { db } from "@/lib/db";
import { eq } from "drizzle-orm";

const KEY = "analytics.sales_targets";

export interface SalesTargets {
  maxCustomerAcquisitionCostIls: number | null;
  dailyAdTestBudgetIls: number | null;
}

const EMPTY_TARGETS: SalesTargets = {
  maxCustomerAcquisitionCostIls: null,
  dailyAdTestBudgetIls: null,
};

function positiveNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export async function loadSalesTargets(): Promise<SalesTargets> {
  const [row] = await db
    .select({ value: appConfig.value })
    .from(appConfig)
    .where(eq(appConfig.key, KEY))
    .limit(1);
  const value = (row?.value ?? {}) as Partial<SalesTargets>;
  return {
    maxCustomerAcquisitionCostIls: positiveNumberOrNull(
      value.maxCustomerAcquisitionCostIls
    ),
    dailyAdTestBudgetIls: positiveNumberOrNull(value.dailyAdTestBudgetIls),
  };
}

export async function saveSalesTargets(input: SalesTargets): Promise<void> {
  const value: SalesTargets = {
    maxCustomerAcquisitionCostIls: positiveNumberOrNull(
      input.maxCustomerAcquisitionCostIls
    ),
    dailyAdTestBudgetIls: positiveNumberOrNull(input.dailyAdTestBudgetIls),
  };
  await db
    .insert(appConfig)
    .values({ key: KEY, value })
    .onConflictDoUpdate({
      target: appConfig.key,
      set: { value, updatedAt: new Date() },
    });
}

export { EMPTY_TARGETS };
