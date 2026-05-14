import "dotenv/config";
import { db } from "../lib/db";
import { bridgeEvents } from "../drizzle/schema";
import { and, eq, sql } from "drizzle-orm";

async function main() {
  const rows = await db
    .select({ id: bridgeEvents.id, type: bridgeEvents.type, payload: bridgeEvents.payload })
    .from(bridgeEvents)
    .where(
      and(
        eq(bridgeEvents.type, "message.received"),
        sql`${bridgeEvents.payload}->'data'->>'chat_jid' = '181703406538760@lid'`
      )
    )
    .limit(3);
  for (const r of rows) {
    console.log("--- event", r.id, r.type, "---");
    console.log(JSON.stringify((r.payload as any)?.data, null, 2));
  }
  if (rows.length === 0) console.log("no rows");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
