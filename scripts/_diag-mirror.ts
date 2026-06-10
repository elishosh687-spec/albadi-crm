import { db } from "../lib/db";
import { sql } from "drizzle-orm";

async function main() {
  const sid = "972542338863@s.whatsapp.net";

  console.log("=== MESSAGES (last 20) ===");
  const m: any = await db.execute(sql`
    SELECT sender, direction, left(coalesce(text,''),60) AS txt, wa_message_id, received_at
    FROM messages WHERE manychat_sub_id = ${sid}
    ORDER BY received_at DESC LIMIT 20`);
  for (const x of m.rows ?? m)
    console.log(`${x.received_at} | ${x.sender}/${x.direction} | wa=${x.wa_message_id ?? "-"} | ${x.txt}`);

  console.log("\n=== GHL MIRROR AUDIT (this sid) ===");
  const a: any = await db.execute(sql`
    SELECT type, payload, occurred_at FROM bridge_events
    WHERE type LIKE 'ghl_mirror.%' AND payload->>'sid' = ${sid}
    ORDER BY occurred_at DESC LIMIT 50`);
  for (const x of a.rows ?? a)
    console.log(`${x.occurred_at} | ${x.type} | ${JSON.stringify(x.payload)}`);

  console.log("\n=== RECENT GHL MIRROR AUDIT (ALL leads, last 30) ===");
  const b: any = await db.execute(sql`
    SELECT type, payload->>'sid' AS sid, payload->>'direction' AS dir, payload->>'sender' AS sender,
           payload->>'reason' AS reason, payload->>'status' AS status, occurred_at
    FROM bridge_events
    WHERE type LIKE 'ghl_mirror.%'
    ORDER BY occurred_at DESC LIMIT 30`);
  for (const x of b.rows ?? b)
    console.log(`${x.occurred_at} | ${x.type} | dir=${x.dir ?? "-"} snd=${x.sender ?? "-"} reason=${x.reason ?? "-"} status=${x.status ?? "-"} | ${x.sid}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
