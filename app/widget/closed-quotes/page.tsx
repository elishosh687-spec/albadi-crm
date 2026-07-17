/**
 * Closed-quotes widget — "הצעות שנסגרו". Post-close reconciliation of WON deals:
 * enter the real factory + shipping (+ other) costs and compare planned vs
 * actual profit. Embedded in the GHL hub via a Custom Menu Link.
 *
 *   https://<host>/widget/closed-quotes?widget_token=<GHL_WIDGET_TOKEN>
 */

import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { ClosedQuotesView } from "@/components/factory-flow/ClosedQuotesView";

export const dynamic = "force-dynamic";

interface SearchParams {
  widget_token?: string;
}

export default async function ClosedQuotesWidgetPage({
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
        <p>חסר / לא תקין <code>widget_token</code>. ודא את ה-Custom Menu Link ב-GHL.</p>
      </div>
    );
  }

  return <ClosedQuotesView apiToken={token} />;
}
