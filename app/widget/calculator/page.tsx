/**
 * Calculator widget — embedded inside GHL contact card via Custom Menu Link.
 *
 * URL template (set in GHL Settings → Custom Menu Links):
 *   https://<host>/widget/calculator?contactId={{contact.id}}&widget_token=<GHL_WIDGET_TOKEN>
 *
 * Renders the same CalculatorView used in /dashboard/v3/calculator, plus a
 * lead-context banner showing which contact is loaded (so Eli sees that the
 * iframe is contact-aware).
 */
import { getFactoryConfig } from "@/lib/factory/config";
import { DEFAULT_CONFIG } from "@/lib/factory/calculator/constants";
import { CalculatorView } from "@/app/dashboard/v3/calculator/CalculatorView";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

interface SearchParams {
  contactId?: string;
  widget_token?: string;
}

interface LeadSnapshot {
  sid: string;
  name: string | null;
  phone: string | null;
  stage: string | null;
  quoteTotal: string | null;
  qState: unknown;
}

async function loadLeadByGhlContactId(
  contactId: string
): Promise<LeadSnapshot | null> {
  const [row] = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      stage: leads.pipelineStage,
      quoteTotal: leads.quoteTotal,
      qState: leads.qState,
    })
    .from(leads)
    .where(eq(leads.ghlContactId, contactId))
    .limit(1);
  return row ?? null;
}

export default async function CalculatorWidgetPage({
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

  const contactId = params.contactId?.trim() ?? "";
  let lead: LeadSnapshot | null = null;
  let leadError: string | null = null;

  if (contactId) {
    try {
      lead = await loadLeadByGhlContactId(contactId);
      if (!lead) {
        leadError = `אין לידmatch לcontactId=${contactId}. עדכן את הסנכרון.`;
      }
    } catch (err) {
      leadError =
        "שגיאה בטעינת הליד: " +
        (err instanceof Error ? err.message : String(err));
    }
  }

  // Load factory config — same as /dashboard/v3/calculator/page.tsx.
  const dbConfig = await getFactoryConfig({ fresh: true });
  const margins = dbConfig.profitMarginByQuantity ?? {
    "1000": dbConfig.defaultProfitMargin,
    "3000": dbConfig.defaultProfitMargin,
    "5000": dbConfig.defaultProfitMargin,
    "10000": dbConfig.defaultProfitMargin,
  };
  const shippingOptions = DEFAULT_CONFIG.shippingOptions
    .map((s) => {
      const dbOpt = dbConfig.shippingOptions.find(
        (d) => d.type === s.type && d.enabled
      );
      if (!dbOpt) return s;
      return {
        ...s,
        enabled: dbOpt.enabled,
        seaRate: dbOpt.seaRate ?? s.seaRate,
        airRates: dbOpt.airRates ?? s.airRates,
      };
    })
    .filter((s) => s.enabled);

  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* Lead context banner */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: "#1a1d24",
          border: "1px solid #2a2d34",
          borderRadius: 8,
          padding: "10px 16px",
          marginBottom: 16,
          fontSize: 14,
        }}
      >
        <div>
          <strong style={{ fontSize: 16 }}>🧮 מחשבון מחיר</strong>
          {lead && (
            <span style={{ marginRight: 12, color: "#a1a1aa" }}>
              · ליד: {lead.name || lead.phone || lead.sid}
              {lead.stage && (
                <span
                  style={{
                    marginRight: 8,
                    padding: "2px 8px",
                    background: "#2563eb",
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                >
                  {lead.stage}
                </span>
              )}
            </span>
          )}
        </div>
        {leadError && (
          <span style={{ color: "#f59e0b", fontSize: 13 }}>⚠️ {leadError}</span>
        )}
        {!contactId && (
          <span style={{ color: "#71717a", fontSize: 13 }}>
            ⚠️ אין contactId — מצב standalone
          </span>
        )}
      </div>

      <CalculatorView
        products={DEFAULT_CONFIG.products}
        quantityTiers={DEFAULT_CONFIG.quantityTiers}
        shippingOptions={shippingOptions}
        initialMargins={margins}
        apiToken={token}
      />
    </div>
  );
}
