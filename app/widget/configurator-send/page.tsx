/**
 * Configurator-send widget — pick a customer and send them the personal 3D
 * configurator link over WhatsApp. Lives as the "מעצב 3D" tab in the hub.
 *
 * URL template:
 *   https://<host>/widget/configurator-send?widget_token=<GHL_WIDGET_TOKEN>
 *
 * Same lead source as the inbox widget (leads table, active rows). Sending
 * reuses POST /api/widget/send-configurator → sendConfiguratorLinkAction.
 */

import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";
import { desc, eq, sql } from "drizzle-orm";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import ConfiguratorSendView, {
  type ConfiguratorSendRow,
} from "@/components/configurator-send/ConfiguratorSendView";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

interface SearchParams {
  widget_token?: string;
}

/** sids that already received a configurator link (best-effort; table may not exist yet). */
async function loadAlreadySentSids(): Promise<Set<string>> {
  try {
    const res = await db.execute(sql`
      SELECT DISTINCT trim(manychat_sub_id) AS sid FROM configurator_sessions
    `);
    const rows = ((res as unknown as { rows?: { sid: string }[] }).rows ?? []);
    return new Set(rows.map((r) => r.sid));
  } catch {
    return new Set();
  }
}

export default async function ConfiguratorSendWidgetPage({
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

  const [leadList, sentSids] = await Promise.all([
    db
      .select({
        sid: leads.manychatSubId,
        name: leads.name,
        phone: leads.phoneE164,
        stage: leads.pipelineStage,
      })
      .from(leads)
      .where(eq(leads.active, true))
      .orderBy(desc(leads.updatedAt)),
    loadAlreadySentSids(),
  ]);

  const rows: ConfiguratorSendRow[] = leadList.map((l) => ({
    sid: l.sid,
    name: l.name,
    phone: l.phone,
    stage: l.stage,
    alreadySent: sentSids.has(l.sid.trim()),
  }));

  return (
    <div style={{ padding: 8 }}>
      <div
        style={{
          background: "#1a1d24",
          border: "1px solid #2a2d34",
          borderRadius: 8,
          padding: "8px 12px",
          marginBottom: 10,
        }}
      >
        <strong style={{ fontSize: 14 }}>🎨 מעצב 3D — בחר לקוח לעיצוב ({rows.length})</strong>
      </div>
      <ConfiguratorSendView apiToken={token} initialRows={rows} />
    </div>
  );
}
