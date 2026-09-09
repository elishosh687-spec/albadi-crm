import "dotenv/config";
import { db } from "../lib/db";
import { leads, messages as m } from "../drizzle/schema";
import { gte, sql } from "drizzle-orm";

async function main() {
  const since = new Date(Date.now() - 8 * 60 * 60 * 1000);

  const msgs = await db
    .select({
      ts: m.receivedAt,
      sid: m.manychatSubId,
      sender: m.sender,
      text: m.text,
      name: leads.name,
      stage: leads.pipelineStage,
      followUpCount: leads.followUpCount,
    })
    .from(m)
    .leftJoin(leads, sql`trim(${leads.manychatSubId}) = trim(${m.manychatSubId})`)
    .where(gte(m.receivedAt, since))
    .orderBy(m.manychatSubId, m.receivedAt);

  let lastSid = "";
  for (const r of msgs) {
    if (r.sid !== lastSid) {
      console.log(
        "\n--- " + (r.name || r.sid) + " [" + r.stage + "] followUpCount=" + r.followUpCount + " ---"
      );
      lastSid = r.sid ?? "";
    }
    const dir =
      r.sender === "lead" ? "< LEAD" : r.sender === "bot" ? "> BOT " : "> ELI ";
    const ts = new Date(r.ts!).toLocaleTimeString("he-IL", {
      timeZone: "Asia/Jerusalem",
    });
    const txt = (r.text ?? "").slice(0, 120).replace(/\n/g, " ⏎ ");
    console.log("  [" + ts + "] " + dir + ": " + txt);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
