/**
 * Bot Decisions widget — embedded inside GHL via Custom Menu Link (sidebar).
 *
 * URL template:
 *   https://<host>/widget/bot-decisions?widget_token=<GHL_WIDGET_TOKEN>
 *
 * Read-only viewer for bot_decision_log. Picker → table.
 */

import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { BotDecisionsView } from "@/components/bot-decisions/BotDecisionsView";

export const dynamic = "force-dynamic";

interface SearchParams {
  widget_token?: string;
}

export default async function BotDecisionsWidgetPage({
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

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: 16 }}>
      <div
        style={{
          background: "#1a1d24",
          border: "1px solid #2a2d34",
          borderRadius: 8,
          padding: "10px 16px",
          marginBottom: 16,
        }}
      >
        <strong style={{ fontSize: 16 }}>🤖 החלטות בוט</strong>
        <span style={{ marginRight: 12, color: "#a1a1aa", fontSize: 13 }}>
          · בחר ליד למטה כדי לראות היסטוריה
        </span>
      </div>

      <BotDecisionsView apiToken={token} />
    </div>
  );
}
