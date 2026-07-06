/**
 * Standalone "בקשת הצעת מחיר" page for the salesperson (Itay). Deliberately
 * NOT part of the main hub tab set — meant to be its own GHL Custom Menu Link
 * so it can be shown to Itay without exposing the rest of the CRM. Submitting
 * parks a draft factory-quote row and DMs Eli; Eli approves + sends to the
 * factory from the existing "הצעות מהמפעל" hub tab.
 *
 * Auth: ?widget_token=<GHL_WIDGET_TOKEN>
 */
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { SalesQuoteRequestForm } from "@/components/factory-request/SalesQuoteRequestForm";

export const dynamic = "force-dynamic";

export default async function FactoryRequestPage({
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
  return <SalesQuoteRequestForm apiToken={token} />;
}
