/**
 * Inbox widget — list all conversations sorted by last message time.
 *
 * URL template:
 *   https://<host>/widget/inbox?widget_token=<GHL_WIDGET_TOKEN>
 *
 * Per-row: name, last msg preview, time ago, sender icon, pause/resume toggle.
 * Mobile-friendly (RTL, big tap targets). Designed for GHL sidebar + direct
 * link bookmark on mobile.
 */

import { db } from "@/lib/db";
import { leads, messages, messageTemplates } from "@/drizzle/schema";
import { asc, desc, eq, sql } from "drizzle-orm";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import InboxView, {
  type InboxRow,
  type QuickTemplate,
} from "@/components/inbox/InboxView";

// How many quick-send buttons to show next to each lead row. Top N active
// templates by sortOrder. Above this, the user opens a full lead/composer.
const QUICK_TEMPLATE_LIMIT = 4;

/**
 * Pick a unique fallback icon when the template name doesn't start with an
 * emoji. First tries keyword heuristics (Hebrew + English), then rotates
 * through a small palette indexed by template id so two templates with no
 * keywords still get visually distinct icons.
 */
function pickFallbackIcon(name: string, id: number): string {
  const lower = name.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/אנחנו|מי\s*אנחנו|about|who/i, "🏢"],
    [/שאלון|שאלות|questionnaire|quiz/i, "📋"],
    [/התחל|מחדש|restart|start\s*over/i, "🔄"],
    [/מידות|מידה|size|dimension/i, "📐"],
    [/מחיר|הצעה|תמחור|price|quote/i, "💰"],
    [/תשלום|payment|pay/i, "💳"],
    [/משלוח|שילוח|shipping|delivery/i, "🚚"],
    [/תודה|thanks|thank\s*you/i, "🙏"],
    [/דוגמ|sample|demo/i, "🧪"],
    [/קטלוג|catalog/i, "📚"],
    [/וידאו|video|הצגה|intro/i, "🎬"],
    [/לוגו|logo|עיצוב|design/i, "🎨"],
    [/אישור|approval|confirm/i, "✅"],
    [/תזכורת|reminder|follow/i, "🔔"],
    [/יצירת קשר|contact/i, "📞"],
  ];
  for (const [pattern, icon] of rules) {
    if (pattern.test(lower)) return icon;
  }
  // Final fallback: rotate through a small generic palette so distinct
  // templates still look distinct.
  const palette = ["✉️", "💬", "📨", "📝", "💡", "⚡", "🎯"];
  return palette[id % palette.length];
}

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 30;

interface SearchParams {
  widget_token?: string;
  sid?: string;
}

export default async function InboxWidgetPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const token = params.widget_token ?? "";
  const selectedSid = params.sid?.trim() ?? "";

  if (!verifyWidgetToken(token)) {
    return (
      <div style={{ padding: 24, color: "#f87171" }}>
        <h2 style={{ marginTop: 0 }}>אין הרשאה</h2>
        <p>חסר / לא תקין <code>widget_token</code>.</p>
      </div>
    );
  }

  const leadList = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      stage: leads.pipelineStage,
      botPaused: leads.botPaused,
      ghlContactId: leads.ghlContactId,
      updatedAt: leads.updatedAt,
    })
    .from(leads)
    .where(eq(leads.active, true))
    .orderBy(desc(leads.updatedAt));

  const ghlLocationId = (process.env.GHL_LOCATION_ID ?? "").replace(/^﻿/, "");
  const ghlBase = `https://app.gohighlevel.com/v2/location/${ghlLocationId}/contacts/detail/`;

  const sids = leadList.map((l) => l.sid.trim());

  type LastMsgRow = {
    sid: string;
    direction: string;
    sender: string | null;
    text: string | null;
    receivedAt: Date;
  };
  type UnreadRow = { sid: string; count: number };

  let lastMsgRows: LastMsgRow[] = [];
  let unreadRows: UnreadRow[] = [];

  if (sids.length > 0) {
    const sidList = sql.join(sids.map((s) => sql`${s}`), sql`, `);
    const [lastResp, unreadResp] = await Promise.all([
      db.execute(sql`
        SELECT sid, direction, sender, text, "receivedAt" FROM (
          SELECT
            trim(manychat_sub_id) AS sid,
            direction,
            sender,
            text,
            received_at AS "receivedAt",
            ROW_NUMBER() OVER (
              PARTITION BY trim(manychat_sub_id)
              ORDER BY received_at DESC
            ) AS rn
          FROM messages
          WHERE trim(manychat_sub_id) IN (${sidList})
        ) t WHERE rn = 1
      `),
      db.execute(sql`
        SELECT trim(manychat_sub_id) AS sid, count(*)::int AS count
        FROM messages
        WHERE trim(manychat_sub_id) IN (${sidList})
          AND direction = 'in'
          AND received_at > now() - interval '24 hours'
        GROUP BY trim(manychat_sub_id)
      `),
    ]);
    lastMsgRows = ((lastResp as unknown as { rows?: LastMsgRow[] }).rows ?? []) as LastMsgRow[];
    unreadRows = ((unreadResp as unknown as { rows?: UnreadRow[] }).rows ?? []) as UnreadRow[];
  }

  const lastBySid = new Map<string, LastMsgRow>();
  for (const r of lastMsgRows) lastBySid.set(r.sid, r);
  const unreadBySid = new Map<string, number>();
  for (const r of unreadRows) unreadBySid.set(r.sid, Number(r.count));

  const unsorted: InboxRow[] = leadList.map((lead) => {
    const sid = lead.sid.trim();
    const last = lastBySid.get(sid) ?? null;
    const sender: "lead" | "bot" | "eli" =
      (last?.sender as "lead" | "bot" | "eli" | null) ??
      (last?.direction === "in" ? "lead" : "bot");
    return {
      sid: lead.sid,
      name: lead.name,
      phone: lead.phone,
      stage: lead.stage,
      botPaused: lead.botPaused,
      lastText: last?.text ?? null,
      lastSender: sender,
      lastAt: last?.receivedAt
        ? new Date(last.receivedAt).toISOString()
        : lead.updatedAt.toISOString(),
      inboundLast24h: unreadBySid.get(sid) ?? 0,
      ghlContactUrl: lead.ghlContactId ? `${ghlBase}${lead.ghlContactId}` : null,
    };
  });

  const rows = unsorted.sort((a, b) => {
    const ta = a.lastAt ? new Date(a.lastAt).getTime() : 0;
    const tb = b.lastAt ? new Date(b.lastAt).getTime() : 0;
    return tb - ta;
  });

  // Load top-N active templates for the per-row quick-send buttons. Each row
  // renders one tiny icon button per template; click → POST /api/widget/
  // send-template. The "icon" is just the first character of the name (so a
  // template named "📐 הסבר מידות שקית" shows 📐).
  const templateRows = await db
    .select({
      id: messageTemplates.id,
      name: messageTemplates.name,
      sortOrder: messageTemplates.sortOrder,
    })
    .from(messageTemplates)
    .where(eq(messageTemplates.active, true))
    .orderBy(asc(messageTemplates.sortOrder), asc(messageTemplates.id))
    .limit(QUICK_TEMPLATE_LIMIT);
  const quickTemplates: QuickTemplate[] = templateRows.map((t) => {
    const trimmed = t.name.trim();
    // Use the leading emoji as the icon when one exists; otherwise pick a
    // distinct icon based on Hebrew/English keyword heuristics so two
    // templates don't share the same ✉️ fallback.
    const first = Array.from(trimmed)[0] ?? "";
    const hasLeadingEmoji = /\p{Extended_Pictographic}/u.test(first);
    const icon = hasLeadingEmoji ? first : pickFallbackIcon(trimmed, t.id);
    return { id: t.id, name: trimmed, icon };
  });

  return (
    <InboxView
      apiToken={token}
      initialRows={rows}
      selectedSid={selectedSid}
      quickTemplates={quickTemplates}
    />
  );
}

// Avoid using the imported `messages` table type unused (silence linter when
// only the SQL template references it).
void messages;
