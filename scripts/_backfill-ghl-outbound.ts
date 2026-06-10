/**
 * Backfill dropped outbound GHL-mirror messages.
 *
 * The JID-namespace bug dropped bot/eli replies from the GHL Inbox for leads
 * whose wa_jid (@c.us) didn't match their sid (@s.whatsapp.net). This re-mirrors
 * the outbound `messages` rows so Eli sees his side of the thread in GHL.
 *
 * Posts land in GHL with the CURRENT time (Conversations API has no backdating),
 * so this is most useful for recent/active threads. Re-running is safe-ish but
 * NOT idempotent — it will post duplicates if run twice on the same sid.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/_backfill-ghl-outbound.ts <sid>            # one lead
 *   DATABASE_URL=... npx tsx scripts/_backfill-ghl-outbound.ts --since 2026-06-08  # all out msgs since date
 *   add --confirm to actually post (default is dry-run)
 */
import { db } from "../lib/db";
import { messages, leads } from "../drizzle/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { forwardMessage } from "../integrations/ghl/sync";

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes("--confirm");
  const sinceIdx = args.indexOf("--since");
  const since = sinceIdx >= 0 ? args[sinceIdx + 1] : null;
  const sidArg = args.find((a) => a.includes("@")) ?? null;

  let rows: any[];
  if (sidArg) {
    rows = await db
      .select({ sid: messages.manychatSubId, sender: messages.sender, text: messages.text, at: messages.receivedAt })
      .from(messages)
      .where(and(eq(messages.manychatSubId, sidArg), eq(messages.direction, "out")))
      .orderBy(messages.receivedAt);
  } else if (since) {
    rows = await db
      .select({ sid: messages.manychatSubId, sender: messages.sender, text: messages.text, at: messages.receivedAt })
      .from(messages)
      .where(and(eq(messages.direction, "out"), gte(messages.receivedAt, new Date(since))))
      .orderBy(messages.receivedAt);
  } else {
    console.error("Pass a <sid> or --since YYYY-MM-DD");
    process.exit(1);
  }

  console.log(`${rows.length} outbound rows to ${confirm ? "MIRROR" : "DRY-RUN"}`);
  for (const r of rows) {
    const sender = (r.sender === "eli" ? "eli" : "bot") as "bot" | "eli";
    const preview = (r.text ?? "").slice(0, 50).replace(/\n/g, " ");
    if (!confirm) {
      console.log(`  [dry] ${r.at} ${r.sid} ${sender}: ${preview}`);
      continue;
    }
    try {
      await forwardMessage({ sid: r.sid, direction: "out", sender, text: r.text, occurredAt: new Date(r.at) });
      console.log(`  [ok]  ${r.at} ${r.sid} ${sender}: ${preview}`);
    } catch (e) {
      console.log(`  [ERR] ${r.sid}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
