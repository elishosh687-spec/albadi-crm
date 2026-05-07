import { db } from "@/lib/db";
import { escalations, decisions, botRuns, repliesSent } from "@/drizzle/schema";
import { desc, eq, isNull, sql } from "drizzle-orm";
import Link from "next/link";

export const dynamic = "force-dynamic";

async function getStats() {
  const [openEscalations, todayDecisions, todayReplies, lastRun] = await Promise.all([
    db
      .select({ id: escalations.id, leadName: escalations.leadName, reason: escalations.reason, triggerText: escalations.triggerText, createdAt: escalations.createdAt, manychatSubId: escalations.manychatSubId })
      .from(escalations)
      .where(isNull(escalations.resolvedAt))
      .orderBy(desc(escalations.createdAt))
      .limit(20),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(decisions)
      .where(sql`${decisions.createdAt} >= now() - interval '24 hours'`),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(repliesSent)
      .where(sql`${repliesSent.sentAt} >= now() - interval '24 hours'`),
    db.select().from(botRuns).orderBy(desc(botRuns.startedAt)).limit(1),
  ]);
  return {
    openEscalations,
    todayDecisions: todayDecisions[0]?.count ?? 0,
    todayReplies: todayReplies[0]?.count ?? 0,
    lastRun: lastRun[0],
  };
}

export default async function DashboardHome() {
  const { openEscalations, todayDecisions, todayReplies, lastRun } = await getStats();

  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 28 }}>בית</h1>
      <p style={{ color: "#666", marginTop: 4 }}>
        תאריך: {new Date().toLocaleDateString("he-IL")}
      </p>

      {/* Open escalations */}
      <Card title={`🟡 ${openEscalations.length} לקוחות מחכים לטיפול`}>
        {openEscalations.length === 0 ? (
          <Empty text="אין הסלמות פתוחות. הבוט מטפל בכל הלידים אוטומטית." />
        ) : (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {openEscalations.map((e) => (
              <li
                key={e.id}
                style={{
                  padding: 12,
                  borderBottom: "1px solid #eee",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {e.leadName ?? e.manychatSubId}{" "}
                    <span style={{ color: "#888", fontWeight: 400, fontSize: 13 }}>
                      — {reasonHe(e.reason)}
                    </span>
                  </div>
                  {e.triggerText && (
                    <div style={{ color: "#666", fontSize: 13, marginTop: 2 }}>
                      {e.triggerText}
                    </div>
                  )}
                </div>
                <Link href={`/dashboard/escalations#e-${e.id}`} style={btnStyle()}>
                  טפל
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Bot summary */}
      <Card title="🤖 פעילות הבוט (24 שעות אחרונות)">
        <Stat label="החלטות" value={todayDecisions} />
        <Stat label="הודעות נשלחו" value={todayReplies} />
        {lastRun && (
          <p style={{ color: "#666", fontSize: 13, marginTop: 12, marginBottom: 0 }}>
            ריצה אחרונה: {new Date(lastRun.startedAt).toLocaleString("he-IL")} —{" "}
            {lastRun.status ?? "?"}
          </p>
        )}
        {!lastRun && (
          <p style={{ color: "#888", fontSize: 13, marginTop: 12, marginBottom: 0 }}>
            הבוט עדיין לא רץ. הפעל אצלך ב-Claude Code: <code>/loop 1h /albadi-bot-run</code>
          </p>
        )}
      </Card>
    </div>
  );
}

function reasonHe(reason: string): string {
  const map: Record<string, string> = {
    low_confidence: "Claude לא בטוחה",
    human_request: "ביקש שיחה אישית",
    pricing: "נושא מחיר/הנחה",
    complaint: "תלונה",
    unknown: "לא מוכר / שבור",
  };
  return map[reason] ?? reason;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        background: "#fff",
        border: "1px solid #e5e5e5",
        borderRadius: 8,
        padding: 16,
        marginTop: 16,
      }}
    >
      <h2 style={{ margin: 0, marginBottom: 12, fontSize: 16 }}>{title}</h2>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return <p style={{ color: "#888", fontSize: 14, margin: 0 }}>{text}</p>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span style={{ marginInlineEnd: 24, fontSize: 14 }}>
      <span style={{ color: "#666" }}>{label}: </span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </span>
  );
}

function btnStyle() {
  return {
    background: "#1a1a1a",
    color: "#fff",
    padding: "8px 14px",
    borderRadius: 6,
    fontSize: 13,
    textDecoration: "none",
  };
}
