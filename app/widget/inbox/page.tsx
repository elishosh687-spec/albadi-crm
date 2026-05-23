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
import { leads, messages } from "@/drizzle/schema";
import { desc, eq, sql } from "drizzle-orm";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import InboxView, { type InboxRow } from "@/components/inbox/InboxView";

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
        <strong style={{ fontSize: 14 }}>📥 שיחות ({rows.length})</strong>
      </div>
      <InboxView apiToken={token} initialRows={rows} selectedSid={selectedSid} />
    </div>
  );
}

// Avoid using the imported `messages` table type unused (silence linter when
// only the SQL template references it).
void messages;
