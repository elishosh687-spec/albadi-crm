import "dotenv/config";
import { db } from "../lib/db";
import { messages, leads, bridgeEvents } from "../drizzle/schema";
import { eq, desc, or, like, sql } from "drizzle-orm";

async function main() {
  const phone = process.argv[2] || "972522541081";
  const jidPattern = "%" + phone + "%";

  console.log("=== LEADS matching", phone, "===");
  const ls = await db.select().from(leads).where(
    or(
      eq(leads.phoneE164, "+" + phone),
      eq(leads.phoneE164, phone),
      like(leads.manychatSubId, jidPattern),
      like(leads.waJid, jidPattern),
    )
  );
  console.log("found:", ls.length);
  for (const l of ls) {
    console.log(JSON.stringify({
      sub: JSON.stringify(l.manychatSubId),
      jid: l.waJid,
      phone: l.phoneE164,
      name: l.name,
      stage: l.pipelineStage,
      botPaused: l.botPaused,
    }));
  }

  console.log("\n=== ALL messages with sub_id containing", phone, "===");
  const ms = await db.select().from(messages)
    .where(like(messages.manychatSubId, jidPattern))
    .orderBy(desc(messages.receivedAt))
    .limit(20);
  console.log("found:", ms.length);
  for (const m of ms) {
    console.log("  -", m.receivedAt?.toISOString(), "sub=" + m.manychatSubId, m.direction, "sender=" + (m.sender || "null"), "wa_id=" + (m.waMessageId || "null"), "|", (m.text || "").slice(0, 80));
  }

  console.log("\n=== bridge_events in last 30 min for", phone, "===");
  const evs = await db.execute(sql`
    SELECT evt_id, type, occurred_at, payload->'data'->>'to' as to_field, payload->'data'->>'from' as from_field, payload->'data'->>'message_id' as msg_id
    FROM bridge_events
    WHERE received_at > NOW() - INTERVAL '30 minutes'
      AND (payload::text LIKE ${jidPattern})
    ORDER BY occurred_at DESC
    LIMIT 20
  `);
  console.log("found:", evs.rows.length);
  for (const e of evs.rows) {
    console.log("  -", e.occurred_at, e.type, "to=" + e.to_field, "from=" + e.from_field, "msg_id=" + e.msg_id);
  }

  console.log("\n=== last 5 outbound 'eli' messages anywhere in last 30 min ===");
  const eli = await db.execute(sql`
    SELECT manychat_sub_id, direction, sender, wa_message_id, text, received_at
    FROM messages
    WHERE received_at > NOW() - INTERVAL '30 minutes'
      AND sender = 'eli'
    ORDER BY received_at DESC
    LIMIT 10
  `);
  console.log("found:", eli.rows.length);
  for (const e of eli.rows) {
    console.log("  -", e.received_at, "sub=" + e.manychat_sub_id, "wa_id=" + e.wa_message_id, "|", String(e.text || "").slice(0, 80));
  }

  process.exit(0);
}
main();
