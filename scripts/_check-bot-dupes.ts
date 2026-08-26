/**
 * "Did the bot answer the same message twice?" — the check for the 2026-08-26
 * duplicate-reply bug (Green API webhook retries + follow-ups firing mid-chat).
 *
 * A re-send is two consecutive bot messages to the same lead, 30s–15min apart,
 * with no customer message between them. The 30s floor is what separates a real
 * re-send from the legitimate rapid sequences (questionnaire → quote → company
 * intro), which land within a second or two of each other.
 *
 * Usage (hours defaults to 24):
 *   DATABASE_URL="$(~/.local/node/bin/neonctl connection-string \
 *     --project-id fragrant-morning-71359670 --org-id org-frosty-star-50411125)" \
 *     npx tsx scripts/_check-bot-dupes.ts [hours]
 */
import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);
const hours = Number(process.argv[2] ?? 24);
const il = (d: unknown) =>
  new Date(d as string).toLocaleString("sv-SE", { timeZone: "Asia/Jerusalem" });

async function main(): Promise<void> {
  const rows = await sql`
    with msgs as (
      select m.manychat_sub_id sid, m.received_at, m.text, m.direction, m.sender,
             lag(m.direction)   over w prev_dir,
             lag(m.sender)      over w prev_sender,
             lag(m.received_at) over w prev_at
      from messages m
      where m.received_at > now() - (${hours} || ' hours')::interval
      window w as (partition by m.manychat_sub_id order by m.received_at))
    select sid, received_at, left(coalesce(text,''),60) t,
           extract(epoch from (received_at - prev_at))::int gap
    from msgs
    where direction = 'out' and sender = 'bot'
      and prev_dir = 'out' and prev_sender = 'bot'
      and received_at - prev_at between interval '30 seconds' and interval '15 minutes'
    order by received_at desc`;

  const list = rows as Array<Record<string, unknown>>;
  // Eli's own number is the bot's DM feed to him, not a customer.
  const customers = list.filter((r) => !String(r.sid).startsWith("972525755705"));

  if (!customers.length) {
    console.log(`✅ אין שליחות כפולות ללקוחות ב-${hours} השעות האחרונות.`);
  } else {
    console.log(`⚠️  ${customers.length} שליחות כפולות ללקוחות ב-${hours} השעות האחרונות:`);
    for (const r of customers) {
      const [lead] = (await sql`
        select name from leads where manychat_sub_id = ${r.sid as string}
      `) as Array<{ name: string | null }>;
      console.log(
        `  ${il(r.received_at)}  +${r.gap}s  ${lead?.name ?? "?"}  ::  ${String(r.t).replace(/\n/g, " ")}`,
      );
    }
  }
  const internal = list.length - customers.length;
  if (internal) console.log(`(ועוד ${internal} ב-DM הפנימי לאלי — לא לקוחות)`);
}

main();
