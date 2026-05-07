import { db } from "@/lib/db";
import { decisions } from "@/drizzle/schema";
import { desc, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const TAGS_ORDER = [
  "ליד_חדש",
  "מעוניין",
  "הצעה_בוט",
  "הצעה_טלפון",
  "בתהליך",
  "לקוח",
  "לא_ענה",
  "לא_רלוונטי",
];

const TAG_COLORS: Record<string, string> = {
  ליד_חדש: "#e3f2fd",
  מעוניין: "#fff3e0",
  הצעה_בוט: "#fff8e1",
  הצעה_טלפון: "#fff8e1",
  בתהליך: "#e8f5e9",
  לקוח: "#dcedc8",
  לא_ענה: "#f5f5f5",
  לא_רלוונטי: "#fafafa",
};

export default async function PipelinePage() {
  // Get latest classification per subscriber
  const latest = await db.execute(sql`
    SELECT DISTINCT ON (manychat_sub_id)
      manychat_sub_id, lead_name, classified_tag, created_at
    FROM decisions
    ORDER BY manychat_sub_id, created_at DESC
  `);

  const rows = (latest.rows ?? latest) as Array<{
    manychat_sub_id: string;
    lead_name: string | null;
    classified_tag: string | null;
    created_at: string;
  }>;

  const grouped: Record<string, typeof rows> = {};
  for (const tag of TAGS_ORDER) grouped[tag] = [];
  for (const row of rows) {
    const tag = row.classified_tag ?? "ליד_חדש";
    if (grouped[tag]) grouped[tag].push(row);
  }

  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 28 }}>Pipeline</h1>
      <p style={{ color: "#666", marginTop: 4, fontSize: 14 }}>
        תצוגת kanban — לידים מקובצים לפי תג. מבוסס על הסיווג האחרון של הבוט לכל ליד.
      </p>

      {rows.length === 0 ? (
        <p style={{ color: "#888", marginTop: 16 }}>
          אין עדיין החלטות מהבוט. ה-pipeline ימולא אחרי שהבוט ירוץ.
        </p>
      ) : (
        <div style={{ display: "flex", gap: 12, overflowX: "auto", marginTop: 16 }}>
          {TAGS_ORDER.map((tag) => (
            <div
              key={tag}
              style={{
                minWidth: 200,
                background: TAG_COLORS[tag] ?? "#f7f7f8",
                borderRadius: 8,
                padding: 12,
              }}
            >
              <h3 style={{ margin: 0, fontSize: 13, color: "#333" }}>
                {tag} ({grouped[tag].length})
              </h3>
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                {grouped[tag].map((r) => (
                  <div
                    key={r.manychat_sub_id}
                    style={{
                      background: "#fff",
                      padding: 8,
                      borderRadius: 4,
                      fontSize: 13,
                      border: "1px solid rgba(0,0,0,0.05)",
                    }}
                  >
                    {r.lead_name ?? r.manychat_sub_id}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
