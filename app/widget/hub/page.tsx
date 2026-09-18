/** GHL Custom Menu entry point for the canonical shared Hub. */

import { HubShell } from "@/components/hub/HubShell";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";

export const dynamic = "force-dynamic";

interface SearchParams {
  widget_token?: string;
  tab?: string;
  sid?: string;
  view?: string;
  section?: string;
}

export default async function HubWidgetPage({
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
        <p>חסר / לא תקין <code>widget_token</code>.</p>
      </div>
    );
  }

  return (
    <HubShell
      mode="widget"
      widgetToken={token}
      activeTab={params.tab}
      sid={params.sid?.trim() ?? ""}
      deepLink={{ view: params.view, section: params.section }}
    />
  );
}
