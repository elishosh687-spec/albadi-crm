/**
 * Bot Preview widget — embedded inside GHL via Custom Menu Link (sidebar).
 *
 * URL template:
 *   https://<host>/widget/bot-preview?widget_token=<GHL_WIDGET_TOKEN>
 *
 * Shows at a glance what the bot is about to do in the next 24h:
 *   - upcoming follow-ups (with cadence + due time)
 *   - drafts pending approval
 *   - factory requests in flight
 *   - leads currently paused (bot skipping)
 */
import { verifyWidgetToken } from "@/integrations/ghl/widget-auth";
import { db } from "@/lib/db";
import { leads, botDrafts, factoryQuoteRequests } from "@/drizzle/schema";
import { eq, and, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const HOUR_MS = 60 * 60 * 1000;
const MAX_FOLLOWUPS = 3;
const CADENCE: Record<string, number[]> = {
  PRE_QUOTE: [1, 1, 1],
  INTAKE: [2, 12, 23],
  DISCAVERY: [2, 12, 23],
  FACTORY_WAIT: [2, 12, 23],
  CONSIDERATION: [2, 12, 23],
};

function jerusalemHour(d: Date): number {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Jerusalem", hour: "numeric", hour12: false }).formatToParts(d);
  return Number(p.find(x => x.type === "hour")?.value ?? 0);
}
function nextSendAt(lastFollowUpAt: Date | null, cadenceHours: number, base: Date): Date {
  const anchor = lastFollowUpAt ?? base;
  const candidate = new Date(anchor.getTime() + cadenceHours * HOUR_MS);
  for (let i = 0; i < 50; i++) {
    const h = jerusalemHour(candidate);
    if (h >= 9 && h < 21) return candidate;
    candidate.setHours(candidate.getHours() + 1);
  }
  return candidate;
}
function formatDelta(deltaMs: number): { text: string; color: string } {
  const mins = Math.round(deltaMs / 60000);
  if (mins < 0) {
    const m = -mins;
    if (m < 60) return { text: `${m} דק' באיחור`, color: "#f87171" };
    if (m < 24 * 60) return { text: `${(m/60).toFixed(1)}h באיחור`, color: "#f87171" };
    return { text: `${(m/60/24).toFixed(1)} ימים באיחור`, color: "#dc2626" };
  }
  if (mins < 60) return { text: `בעוד ${mins}m`, color: "#10b981" };
  return { text: `בעוד ${(mins/60).toFixed(1)}h`, color: "#3b82f6" };
}

async function loadPreview() {
  const now = new Date();

  const active = await db
    .select()
    .from(leads)
    .where(and(eq(leads.active, true), eq(leads.botPaused, false)));

  const upcoming: Array<{ sid: string; name: string | null; stage: string; attempt: number; sendAt: Date }> = [];
  for (const l of active) {
    if (l.followUpCount >= MAX_FOLLOWUPS) continue;
    const stageKey = l.pipelineStage ?? 'PRE_QUOTE';
    const cad = CADENCE[stageKey];
    if (!cad) continue;
    const hours = cad[Math.min(l.followUpCount, cad.length - 1)];
    const sendAt = nextSendAt(l.lastFollowUpAt, hours, now);
    const deltaMs = sendAt.getTime() - now.getTime();
    if (deltaMs > 36 * HOUR_MS) continue;
    upcoming.push({ sid: l.manychatSubId, name: l.name, stage: stageKey, attempt: l.followUpCount + 1, sendAt });
  }
  upcoming.sort((a, b) => a.sendAt.getTime() - b.sendAt.getTime());

  const drafts = await db.select().from(botDrafts).where(eq(botDrafts.status, 'pending'));

  const factoryRows = await db
    .select()
    .from(factoryQuoteRequests)
    .where(sql`${factoryQuoteRequests.factoryStatus} != 'finalized'`);

  const paused = await db
    .select({ sid: leads.manychatSubId, name: leads.name, stage: leads.pipelineStage, updatedAt: leads.updatedAt })
    .from(leads)
    .where(eq(leads.botPaused, true));

  return { now, upcoming, drafts, factoryRows, paused };
}

const SECTION_STYLE: React.CSSProperties = {
  background: "#1a1d24",
  border: "1px solid #2a2d34",
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
};
const ROW_STYLE: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "180px 90px 200px 1fr",
  gap: 12,
  padding: "6px 0",
  borderBottom: "1px solid #2a2d34",
  fontSize: 13,
  alignItems: "center",
};

export default async function BotPreviewWidget({ searchParams }: { searchParams: Promise<{ widget_token?: string }> }) {
  const params = await searchParams;
  const token = params.widget_token ?? "";
  if (!verifyWidgetToken(token)) {
    return <div style={{ padding: 24, color: "#f87171" }}>אין הרשאה</div>;
  }

  const data = await loadPreview();

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16, color: "#e5e7eb", fontFamily: "system-ui, sans-serif", direction: "rtl" }}>
      <div style={{ marginBottom: 12, fontSize: 13, color: "#9ca3af" }}>
        עכשיו: {data.now.toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" })}
      </div>

      {/* Follow-ups */}
      <section style={SECTION_STYLE}>
        <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>
          📞 פולואפים מתוכננים ({data.upcoming.length})
        </h3>
        {data.upcoming.length === 0 ? (
          <div style={{ color: "#9ca3af" }}>אין פולואפים מתוכננים ב-36 שעות הקרובות</div>
        ) : (
          <>
            <div style={{ ...ROW_STYLE, fontWeight: "bold", color: "#9ca3af", borderBottom: "2px solid #374151" }}>
              <span>מתי</span>
              <span>ניסיון</span>
              <span>stage</span>
              <span>ליד</span>
            </div>
            {data.upcoming.map((u, i) => {
              const d = formatDelta(u.sendAt.getTime() - data.now.getTime());
              return (
                <div key={i} style={ROW_STYLE}>
                  <span style={{ color: d.color, fontWeight: 600 }}>{d.text}</span>
                  <span>{u.attempt}/{MAX_FOLLOWUPS}</span>
                  <span style={{ color: "#a5b4fc", fontSize: 12 }}>{u.stage}</span>
                  <span>{u.name ?? u.sid.slice(0, 25)}</span>
                </div>
              );
            })}
          </>
        )}
      </section>

      {/* Drafts */}
      <section style={SECTION_STYLE}>
        <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>
          ✋ טיוטות ממתינות לאישור ({data.drafts.length})
        </h3>
        {data.drafts.length === 0 ? (
          <div style={{ color: "#9ca3af" }}>אין טיוטות ממתינות</div>
        ) : (
          data.drafts.map((d) => (
            <div key={d.id} style={{ padding: "8px 0", borderBottom: "1px solid #2a2d34" }}>
              <div style={{ fontSize: 12, color: "#fbbf24" }}>
                #{d.id} · {d.moneyReason ?? "—"} · {d.manychatSubId.slice(0, 25)}
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{(d.draftText ?? "").slice(0, 200)}</div>
            </div>
          ))
        )}
      </section>

      {/* Factory */}
      <section style={SECTION_STYLE}>
        <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>
          🏭 בקשות מפעל פתוחות ({data.factoryRows.length})
        </h3>
        {data.factoryRows.length === 0 ? (
          <div style={{ color: "#9ca3af" }}>אין בקשות פתוחות</div>
        ) : (
          data.factoryRows.map((f) => (
            <div key={f.id} style={{ padding: "6px 0", borderBottom: "1px solid #2a2d34", fontSize: 13 }}>
              <span style={{ color: f.factoryStatus === "received" ? "#fbbf24" : "#9ca3af" }}>
                {f.factoryStatus}
              </span>
              {" · "}
              <span style={{ color: "#9ca3af" }}>{f.manychatSubId.slice(0, 30)}</span>
            </div>
          ))
        )}
      </section>

      {/* Paused */}
      <section style={SECTION_STYLE}>
        <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>
          😴 הבוט מושהה ({data.paused.length})
        </h3>
        {data.paused.length === 0 ? (
          <div style={{ color: "#9ca3af" }}>הבוט פעיל לכל הלידים</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 8 }}>
            {data.paused.map((p) => (
              <div key={p.sid} style={{ padding: "6px 8px", background: "#0f1115", borderRadius: 4, fontSize: 13 }}>
                <div>{p.name ?? p.sid.slice(0, 25)}</div>
                <div style={{ fontSize: 11, color: "#6b7280" }}>{p.stage ?? "no stage"}</div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
