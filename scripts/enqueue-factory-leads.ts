import "dotenv/config";
import { db } from "../lib/db";
import { analysisQueue } from "../drizzle/schema";
import { eq, and, inArray } from "drizzle-orm";

const SIDS = ["738273208", "349879455", "1697234370"];

async function main() {
  const open = await db
    .select({ sid: analysisQueue.manychatSubId, status: analysisQueue.status })
    .from(analysisQueue)
    .where(
      and(
        inArray(analysisQueue.manychatSubId, SIDS),
        inArray(analysisQueue.status, ["pending", "analyzing"])
      )
    );
  const alreadyOpen = new Set(open.map((r) => r.sid));
  const toInsert = SIDS.filter((s) => !alreadyOpen.has(s));
  if (toInsert.length === 0) {
    console.log("All 3 already in queue");
  } else {
    const inserted = await db
      .insert(analysisQueue)
      .values(toInsert.map((sid) => ({ manychatSubId: sid, reason: "notes_updated" })))
      .returning({ id: analysisQueue.id, sid: analysisQueue.manychatSubId });
    console.log(`Inserted ${inserted.length}:`, inserted);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
