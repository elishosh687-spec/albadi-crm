/**
 * Widget "צבעים" screen — the shared colour catalogue plus each factory's own
 * palette, and a note next to every factory saying when you order from it.
 *
 * Static data (lib/colors/factory-catalog.ts) — no DB, no Feishu call.
 *
 * Auth: ?widget_token=<GHL_WIDGET_TOKEN>
 */
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import ColorCatalogScreen from "@/components/colors/ColorCatalogScreen";

export const dynamic = "force-dynamic";

export default async function ColorsWidgetPage({
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
  return <ColorCatalogScreen />;
}
