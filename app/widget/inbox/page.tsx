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
import { leads, messages, messageTemplates, leadAnalyses } from "@/drizzle/schema";
import { asc, desc, eq, sql } from "drizzle-orm";
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { type InboxRow, type QuickTemplate } from "@/components/inbox/InboxView";
import CockpitShell from "@/components/inbox/CockpitShell";
import { type CockpitLead } from "@/components/inbox/CockpitView";
import { loadFollowupQueue } from "@/lib/dashboard/followup-queue";
import { getStagePlay } from "@/lib/sales/stage-plays.he";
import { normalizeStage, V2_STAGE_LABELS } from "@/lib/manychat/stages";

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

// ─── Cockpit presentation helpers (pure display formatting — no logic) ───

// Format an already-computed nextEligibleAt timestamp into a calm Hebrew
// relative label. This is DISPLAY of an existing cadence result (from
// loadFollowupQueue), NOT a re-computation of cadence.
function urgencyLabel(nextEligibleAt: Date | null, now: number): string | null {
  if (!nextEligibleAt) return null;
  const diff = nextEligibleAt.getTime() - now;
  const DAY = 86_400_000;
  const HOUR = 3_600_000;
  if (diff <= 0) {
    const lateDays = Math.floor(-diff / DAY);
    if (lateDays >= 2) return `באיחור ${lateDays} ימים`;
    if (lateDays === 1) return "באיחור יום";
    const lateHours = Math.floor(-diff / HOUR);
    if (lateHours >= 1) return `באיחור ${lateHours} שע׳`;
    return "עכשיו";
  }
  if (diff < HOUR) return "בקרוב";
  if (diff < DAY) return `בעוד ${Math.round(diff / HOUR)} שע׳`;
  const days = Math.round(diff / DAY);
  return days <= 1 ? "מחר" : `בעוד ${days} ימים`;
}

// quote_total is free text. Show as-is; prefix ₪ only when it's a bare number
// (with optional separators), so "₪18,400" / "סוכם" survive unchanged.
function valueDisplay(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  if (/^[\d.,\s]+$/.test(t)) return `₪${t}`;
  return t;
}

// Primary-button label by stage. UI affordance default — NOT a transition.
function actionLabelForStage(stage: string | null): string {
  switch ((stage ?? "").toUpperCase()) {
    case "INTAKE":
      return "שלח הצעה";
    case "DISCAVERY":
      return "שלח תשובה";
    case "FACTORY_WAIT":
      return "תזכיר לי מחר";
    case "CONSIDERATION":
      return "שלח הצעה משופרת";
    default:
      return "פתח שיחה";
  }
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
      // Additive reads for the cockpit assembly below (presentation only).
      botSummary: leads.botSummary,
      quoteTotal: leads.quoteTotal,
      qState: leads.qState,
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

  // ─── Cockpit assembly (all READS; existing helpers reused) ───
  // Urgency: existing computed nextEligibleAt from loadFollowupQueue, indexed
  // by sid. Recommended action+script: latest lead_analyses verdict's
  // primary_blocker → getStagePlay. Both indexed once, no per-lead queries.
  const now = Date.now();
  const queue = await loadFollowupQueue();
  const nextBySid = new Map<string, Date>();
  for (const q of queue) nextBySid.set(q.sid.trim(), q.nextEligibleAt);

  const analysisRows = sids.length
    ? await db
        .select({
          sid: leadAnalyses.manychatSubId,
          verdict: leadAnalyses.verdict,
        })
        .from(leadAnalyses)
        .where(
          sql`trim(${leadAnalyses.manychatSubId}) IN (${sql.join(
            sids.map((s) => sql`${s}`),
            sql`, `
          )})`
        )
        .orderBy(desc(leadAnalyses.createdAt))
    : [];
  // First row per sid = latest verdict (rows are createdAt DESC).
  const blockerBySid = new Map<string, string | null>();
  for (const a of analysisRows) {
    const s = a.sid.trim();
    if (blockerBySid.has(s)) continue;
    const v = a.verdict as { primary_blocker?: string } | null;
    blockerBySid.set(s, v?.primary_blocker ?? null);
  }

  const lastTextBySid = new Map<string, InboxRow>();
  for (const r of rows) lastTextBySid.set(r.sid.trim(), r);

  const cockpitLeads: CockpitLead[] = leadList
    // WON/LOST are not a "who needs you now" concern.
    .filter((l) => {
      const s = normalizeStage(l.stage);
      return s !== "WON" && s !== "LOST";
    })
    .map((l) => {
      const sid = l.sid.trim();
      const row = lastTextBySid.get(sid);
      const blocker = blockerBySid.get(sid) ?? null;
      const play = getStagePlay(blocker);
      const normalized = normalizeStage(l.stage);
      const stageLabel = normalized ? V2_STAGE_LABELS[normalized] : null;
      const nextAt = nextBySid.get(sid) ?? null;
      // what they want: bot_summary, else last inbound text (trimmed).
      const lastInbound =
        row && row.lastSender === "lead" ? (row.lastText ?? null) : null;
      const want =
        (l.botSummary && l.botSummary.trim()) ||
        (lastInbound ? lastInbound.trim() : null);
      return {
        sid: l.sid,
        name: l.name,
        phone: l.phone,
        stage: l.stage,
        stageLabel,
        want: want || null,
        value: valueDisplay(l.quoteTotal),
        lastInbound,
        urgencyLabel: urgencyLabel(nextAt, now),
        overdue: nextAt ? nextAt.getTime() <= now : false,
        script: play.lines[0] ?? null,
        actionLabel: actionLabelForStage(l.stage),
      };
    })
    // Sort by nextEligibleAt asc (overdue first); leads with no queue entry
    // sink to the bottom.
    .sort((a, b) => {
      const ta = nextBySid.get(a.sid.trim())?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const tb = nextBySid.get(b.sid.trim())?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return ta - tb;
    });

  return (
    <CockpitShell
      apiToken={token}
      cockpitLeads={cockpitLeads}
      inboxRows={rows}
      quickTemplates={quickTemplates}
      selectedSid={selectedSid}
    />
  );
}

// Avoid using the imported `messages` table type unused (silence linter when
// only the SQL template references it).
void messages;
