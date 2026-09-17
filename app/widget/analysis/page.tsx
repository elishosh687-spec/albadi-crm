/**
 * Compatibility route. Lead diagnosis now lives inside canonical analytics.
 *
 * Auth: ?widget_token=<GHL_WIDGET_TOKEN>
 */
import { redirect } from "next/navigation";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";

export const dynamic = "force-dynamic";

export default async function AnalysisWidgetPage({
  searchParams,
}: {
  searchParams: Promise<{ widget_token?: string }>;
}) {
  const { widget_token } = await searchParams;
  const token = widget_token ?? "";
  if (!verifyWidgetToken(token)) {
    return (
      <div dir="rtl" style={{ padding: 24, color: "#f87171" }}>
        <h2 style={{ marginTop: 0 }}>אין הרשאה</h2>
        <p>
          חסר / לא תקין <code>widget_token</code>.
        </p>
      </div>
    );
  }
  redirect(`/widget/analytics?widget_token=${encodeURIComponent(token)}&view=diagnosis`);
}
