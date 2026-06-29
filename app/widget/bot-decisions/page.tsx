/**
 * Bot Decisions + Drafts widget — embedded inside GHL via Custom Menu Link.
 *
 * URL template:
 *   https://<host>/widget/bot-decisions?widget_token=<GHL_WIDGET_TOKEN>
 *
 * Two tabs: drafts approval queue + read-only bot_decision_log history.
 * Eli supervises the bot from one widget.
 */

import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { DraftsWithDecisions } from "@/components/drafts/DraftsWithDecisions";

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

  return <DraftsWithDecisions apiToken={token} />;
}
