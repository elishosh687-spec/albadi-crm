/**
 * Standalone "בקשת הצעת מחיר" page for the salesperson (Itay). Deliberately
 * NOT part of the main hub tab set — meant to be its own GHL Custom Menu Link
 * so it can be shown to Itay without exposing the rest of the CRM. Submitting
 * parks a draft factory-quote row and DMs Eli; Eli approves + sends to the
 * factory from the existing "הצעות מהמפעל" hub tab.
 *
 * Auth: ?widget_token=<GHL_WIDGET_TOKEN>
 */
import { widgetPageAuthed } from "@/lib/widget/page-auth";
import { SalesQuoteRequestForm } from "@/components/factory-request/SalesQuoteRequestForm";

export const dynamic = "force-dynamic";

export default async function FactoryRequestPage({
  searchParams,
}: {
  // Prefill (deep link from the calculator's estimate tab when it refused to price):
  // h/d/w/qty/colors/handles/lam/thermal + the lead (sid/name) + the refusal reason.
  searchParams: Promise<{
    widget_token?: string;
    sid?: string; name?: string;
    h?: string; d?: string; w?: string; qty?: string;
    colors?: string; handles?: string; lam?: string; thermal?: string;
    note?: string;
  }>;
}) {
  const sp = await searchParams;
  const token = sp.widget_token ?? "";
  if (!(await widgetPageAuthed(token))) {
    return (
      <div dir="rtl" style={{ padding: 24, color: "#f87171" }}>
        <h2 style={{ marginTop: 0 }}>אין הרשאה</h2>
        <p>
          חסר / לא תקין <code>widget_token</code>.
        </p>
      </div>
    );
  }
  const bool = (v: string | undefined) => (v === "true" ? true : v === "false" ? false : undefined);
  return (
    <SalesQuoteRequestForm
      apiToken={token}
      prefill={{
        sid: sp.sid, name: sp.name,
        h: sp.h, d: sp.d, w: sp.w, qty: sp.qty,
        colors: sp.colors ? parseInt(sp.colors, 10) || undefined : undefined,
        handles: bool(sp.handles), lam: bool(sp.lam), thermal: bool(sp.thermal),
        notes: sp.note,
      }}
    />
  );
}
