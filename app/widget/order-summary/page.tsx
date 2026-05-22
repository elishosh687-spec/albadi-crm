/**
 * Order Summary widget — embedded inside GHL contact card via Custom Menu Link.
 *
 * URL template:
 *   https://<host>/widget/order-summary?contactId={{contact.id}}&widget_token=<GHL_WIDGET_TOKEN>
 *
 * Read-only. Stage / notes / tags editing happens in GHL native — this surface
 * just displays q_state, factory spec draft, quote totals, follow-up date,
 * lead source, bot summary, and notes. Phase 1G-1 of the GHL migration.
 */
import { db } from "@/lib/db";
import { leads, leadTags } from "@/drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import {
  OrderSummaryView,
  type OrderSummaryWidgetData,
} from "@/components/order-summary/OrderSummaryView";

export const dynamic = "force-dynamic";

interface SearchParams {
  contactId?: string;
  sid?: string;
  widget_token?: string;
}

async function loadOrderSummary(
  contactId: string,
  sid: string
): Promise<OrderSummaryWidgetData | null> {
  const where = sid
    ? sql`trim(${leads.manychatSubId}) = ${sid}`
    : eq(leads.ghlContactId, contactId);
  const [row] = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      leadSource: leads.leadSource,
      stage: leads.pipelineStage,
      flag: leads.pipelineFlag,
      botPaused: leads.botPaused,
      botSummary: leads.botSummary,
      notes: leads.notes,
      quoteTotal: leads.quoteTotal,
      quoteAlt: leads.quoteAlt,
      qState: leads.qState,
      factorySpecDraft: leads.factorySpecDraft,
      followUpDate: leads.followUpDate,
    })
    .from(leads)
    .where(where)
    .limit(1);

  if (!row) return null;

  const tagRows = row.sid
    ? await db
        .select({ tag: leadTags.tag })
        .from(leadTags)
        .where(eq(leadTags.manychatSubId, row.sid))
    : [];

  return {
    sid: row.sid,
    name: row.name,
    phone: row.phone,
    leadSource: row.leadSource,
    stage: row.stage,
    flag: row.flag,
    flags: tagRows.map((t) => t.tag),
    botPaused: row.botPaused,
    botSummary: row.botSummary,
    notes: row.notes,
    quoteTotal: row.quoteTotal,
    quoteAlt: row.quoteAlt,
    qState: (row.qState as Record<string, unknown> | null) ?? null,
    factorySpecDraft:
      (row.factorySpecDraft as Record<string, unknown> | null) ?? null,
    followUpDate: row.followUpDate,
  };
}

export default async function OrderSummaryWidgetPage({
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

  const contactId = params.contactId?.trim() ?? "";
  const sid = params.sid?.trim() ?? "";
  if (!contactId && !sid) {
    return (
      <div style={{ padding: 24, color: "#f59e0b" }}>
        <h2 style={{ marginTop: 0 }}>בחר ליד</h2>
        <p>פתח את לשונית 📥 שיחות ולחץ על שם של ליד.</p>
      </div>
    );
  }

  let data: OrderSummaryWidgetData | null = null;
  let loadError: string | null = null;
  try {
    data = await loadOrderSummary(contactId, sid);
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  if (loadError) {
    return (
      <div style={{ padding: 24, color: "#f87171" }}>
        <h2 style={{ marginTop: 0 }}>שגיאה בטעינה</h2>
        <p>{loadError}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 24, color: "#f59e0b" }}>
        <h2 style={{ marginTop: 0 }}>אין ליד</h2>
        <p>לא נמצא ליד עם {sid ? <code>sid={sid}</code> : <code>ghl_contact_id={contactId}</code>}.</p>
      </div>
    );
  }

  return <OrderSummaryView data={data} />;
}
