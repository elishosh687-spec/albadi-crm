/**
 * Shipping consolidation widget — embedded in GHL via the hub tab.
 *
 * URL: https://<host>/widget/shipping?widget_token=<GHL_WIDGET_TOKEN>
 *
 * Pulls real finalized SEA orders and renders the consolidation planner.
 */

import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { loadConsolidationCandidates } from "@/lib/factory/consolidation";
import { getActiveSeaCarrier } from "@/lib/factory/sea-carriers";
import { ConsolidationView } from "@/components/shipping/ConsolidationView";

export const dynamic = "force-dynamic";

interface SearchParams {
  widget_token?: string;
}

export default async function ShippingWidgetPage({
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
          חסר / לא תקין <code>widget_token</code>. ודא את ה-Custom Menu Link ב-GHL.
        </p>
      </div>
    );
  }

  const { candidates, config } = await loadConsolidationCandidates();
  const carrier = getActiveSeaCarrier(config);
  const locationId = process.env.GHL_LOCATION_ID;
  const ghlContactBase = locationId
    ? `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/`
    : undefined;

  return (
    <ConsolidationView
      candidates={candidates}
      carrier={carrier}
      usdToIls={config.usdToIls}
      ghlContactBase={ghlContactBase}
    />
  );
}
