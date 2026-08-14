/**
 * Bot playground widget — chat with the real bot without sending WhatsApp.
 *
 * URL template:
 *   https://<host>/widget/playground?widget_token=<GHL_WIDGET_TOKEN>
 */

import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import PlaygroundView from "@/components/playground/PlaygroundView";

export const dynamic = "force-dynamic";

interface SearchParams {
  widget_token?: string;
}

export default async function PlaygroundWidgetPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const token = params.widget_token ?? "";

  if (!verifyWidgetToken(token)) {
    return (
      <div style={{ padding: 24, color: "#f87171" }} dir="rtl">
        <h2 style={{ marginTop: 0 }}>אין הרשאה</h2>
        <p>
          חסר / לא תקין <code>widget_token</code>.
        </p>
      </div>
    );
  }

  return <PlaygroundView apiToken={token} />;
}
