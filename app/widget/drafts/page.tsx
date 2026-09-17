/**
 * Drafts queue widget — embedded inside GHL via Custom Menu Link (sidebar).
 *
 * URL template:
 *   https://<host>/widget/drafts?widget_token=<GHL_WIDGET_TOKEN>
 *
 * Shows every bot_drafts row with status='pending'. Approve sends through the
 * WhatsApp bridge; reject marks the draft and attaches Eli's verdict to the
 * matching bot_decision_log row.
 */

import { widgetPageAuthed } from "@/lib/widget/page-auth";
import { DraftsWithDecisions } from "@/components/drafts/DraftsWithDecisions";

export const dynamic = "force-dynamic";

interface SearchParams {
  widget_token?: string;
}

export default async function DraftsWidgetPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const token = params.widget_token ?? "";

  if (!(await widgetPageAuthed(token))) {
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
