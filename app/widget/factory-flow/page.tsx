/**
 * Factory-flow widget — embedded inside GHL via Custom Menu Link (sidebar).
 *
 * URL template (GHL Settings → Agency Custom Menu Links):
 *   https://<host>/widget/factory-flow?widget_token=<GHL_WIDGET_TOKEN>
 *
 * No `contactId` in the URL — the operator picks the lead inside the widget.
 * That sidesteps the GHL `$uxMessage` bug that breaks Custom Menu Links
 * containing `{{contact.id}}`.
 */

import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { FactoryFlowView } from "@/components/factory-flow/FactoryFlowView";

export const dynamic = "force-dynamic";

interface SearchParams {
  widget_token?: string;
}

export default async function FactoryFlowWidgetPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const token = params.widget_token ?? "";

  if (!verifyWidgetToken(token)) {
    return (
      <div style={{ padding: 24, color: "#f87171" }}>
        <h2 style={{ marginTop: 0 }}>אין הרשאה</h2>
        <p>
          חסר / לא תקין <code>widget_token</code>. ודא את ה-Custom Menu Link
          ב-GHL.
        </p>
      </div>
    );
  }

  return <FactoryFlowView apiToken={token} />;
}
