/**
 * Audit: WhatsApp activity present, but lead is NOT in GHL.
 *
 * "לידים שנופלים בין הכיסאות" — שיחות שנכנסות ל-bot/קמפיין אבל אין להם
 * ghl_contact_id, אז אלי לא רואה אותם ב-GHL.
 *
 * Run:   DATABASE_URL=... npx tsx scripts/audit-ghl-gap.ts
 */
import { db } from "../lib/db";
import { leads, messages } from "../drizzle/schema";
import { and, desc, eq, isNull, isNotNull, sql } from "drizzle-orm";

async function main() {
  const orphans = await db
    .select({
      sid: leads.manychatSubId,
      name: leads.name,
      phone: leads.phoneE164,
      jid: leads.waJid,
      stage: leads.pipelineStage,
      paused: leads.botPaused,
      lastResponse: leads.lastResponseAt,
      createdAt: leads.createdAt,
      source: leads.source,
      msgCount: sql<number>`(select count(*)::int from ${messages} m where m.manychat_sub_id = ${leads.manychatSubId})`,
      lastInbound: sql<Date | null>`(select max(m.received_at) from ${messages} m where m.manychat_sub_id = ${leads.manychatSubId} and m.direction = 'in')`,
      lastOutbound: sql<Date | null>`(select max(m.received_at) from ${messages} m where m.manychat_sub_id = ${leads.manychatSubId} and m.direction = 'out')`,
    })
    .from(leads)
    .where(and(isNull(leads.ghlContactId), eq(leads.active, true)))
    .orderBy(desc(leads.createdAt));

  const withActivity = orphans.filter(
    (l) => (l.msgCount ?? 0) > 0 || l.jid || l.phone,
  );
  const botTouched = withActivity.filter((l) => l.lastOutbound);

  console.log(`\n=== GHL-gap audit ===`);
  console.log(`Total active leads with no ghl_contact_id : ${orphans.length}`);
  console.log(`  └─ with WhatsApp activity (msg/jid/phone): ${withActivity.length}`);
  console.log(`     └─ bot has already sent to them      : ${botTouched.length}\n`);

  if (botTouched.length === 0) {
    console.log("✅ No bot-touched leads are missing from GHL.");
    return;
  }

  console.log("LEADS THE BOT MESSAGED BUT GHL DOESN'T HAVE:\n");
  for (const l of botTouched.slice(0, 50)) {
    console.log(
      [
        `• ${l.name ?? "(no name)"} ${l.phone ?? l.jid ?? "(no phone)"}`,
        `   stage=${l.stage ?? "—"}  paused=${l.paused}  src=${l.source}  msgs=${l.msgCount}`,
        `   last_in=${fmt(l.lastInbound)}  last_out=${fmt(l.lastOutbound)}  created=${fmt(l.createdAt)}`,
        `   sid=${l.sid}`,
      ].join("\n"),
    );
  }
  if (botTouched.length > 50)
    console.log(`\n…and ${botTouched.length - 50} more.`);
}

function fmt(d: Date | null | undefined) {
  return d ? new Date(d).toISOString().replace("T", " ").slice(0, 16) : "—";
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
