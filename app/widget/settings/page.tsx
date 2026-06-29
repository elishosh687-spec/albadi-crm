/**
 * Settings widget — embedded inside GHL via Custom Menu Link (sidebar).
 *
 * URL template:
 *   https://<host>/widget/settings?widget_token=<GHL_WIDGET_TOKEN>
 *
 * Edits the factory_pricing config: FX rates, default margin, per-quantity
 * margins, and shipping options. PUT goes through /api/widget/factory/config.
 */

import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { SettingsView } from "@/components/settings/SettingsView";

export const dynamic = "force-dynamic";

interface SearchParams {
  widget_token?: string;
}

export default async function SettingsWidgetPage({
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

  return <SettingsView apiToken={token} />;
}
