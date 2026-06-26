/**
 * Widget "ניתוח לידים" screen — filtered bulk analysis + the deterministic
 * "why aren't leads closing" rollup. Opened as a hub tab.
 *
 * Auth: ?widget_token=<GHL_WIDGET_TOKEN>
 */
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import AnalysisScreen from "@/components/analysis/AnalysisScreen";

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
  return <AnalysisScreen token={token} />;
}
