/**
 * Widget "מחיר מתחרים" screen — competitor price + lead-time intelligence.
 * Eli logs each competing quote he runs into (our price/lead-time vs theirs for
 * a product spec) and sees exactly where Albadi stands. Opened as a hub tab.
 *
 * Auth: ?widget_token=<GHL_WIDGET_TOKEN>
 */
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import CompetitorsScreen from "@/components/competitors/CompetitorsScreen";

export const dynamic = "force-dynamic";

export default async function CompetitorsWidgetPage({
  searchParams,
}: {
  searchParams: Promise<{ widget_token?: string; sid?: string }>;
}) {
  const { widget_token, sid } = await searchParams;
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
  return <CompetitorsScreen token={token} leadSid={sid?.trim() || ""} />;
}
