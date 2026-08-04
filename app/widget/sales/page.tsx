/**
 * /widget/sales?token=<WIDGET_SALES_TOKEN> — the salesperson screen.
 *
 * Point the GHL custom menu link here. The page only holds the token and hands
 * it to the client calculator; all data comes from the /api/sales/* endpoints,
 * which return customer-facing numbers only (no cost/profit/margin/commission).
 */
import { WIDGET_SALES_TOKEN } from "@/lib/widget/sales-auth";
import { SalesShell } from "@/components/sales/SalesShell";

export const dynamic = "force-dynamic";

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; sales_token?: string }>;
}) {
  const sp = await searchParams;
  const token = (sp.token ?? sp.sales_token ?? "").trim();
  const ok = WIDGET_SALES_TOKEN ? token === WIDGET_SALES_TOKEN : false;

  if (!ok) {
    return (
      <div dir="rtl" className="mx-auto max-w-md p-8 text-center text-sm text-muted-foreground">
        אין הרשאה למסך המכירות.
      </div>
    );
  }
  return <SalesShell token={token} />;
}
