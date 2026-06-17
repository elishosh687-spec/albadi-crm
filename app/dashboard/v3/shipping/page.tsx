/**
 * /dashboard/v3/shipping — shipment consolidation planner (dashboard side).
 * Mirrors the /widget/shipping embedded view; same data + engine.
 */

import { loadConsolidationCandidates } from "@/lib/factory/consolidation";
import { getActiveSeaCarrier } from "@/lib/factory/sea-carriers";
import { ConsolidationView } from "@/components/shipping/ConsolidationView";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function V3ShippingPage() {
  const { candidates, config } = await loadConsolidationCandidates();
  const carrier = getActiveSeaCarrier(config);
  const locationId = process.env.GHL_LOCATION_ID;
  const ghlContactBase = locationId
    ? `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/`
    : undefined;

  return (
    <div className="max-w-3xl">
      <ConsolidationView
        candidates={candidates}
        carrier={carrier}
        usdToIls={config.usdToIls}
        ghlContactBase={ghlContactBase}
      />
    </div>
  );
}
