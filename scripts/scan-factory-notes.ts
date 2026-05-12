import "dotenv/config";
import { db } from "../lib/db";
import { leads } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import { getSubscriber, getFieldValue } from "../lib/manychat/client";

async function main() {
  const rows = await db
    .select({ id: leads.manychatSubId, name: leads.name })
    .from(leads)
    .where(eq(leads.active, true));
  const sids = Array.from(new Set(rows.map((r) => r.id.trim()).filter(Boolean)));
  console.log(`Scanning ${sids.length} active leads…\n`);

  const keywords = ["מפעל", "ספק", "תמחור"];
  const hits: Array<{ sid: string; name: string | null; notes: string }> = [];

  // Serial with delay + retry on 429.
  for (const sid of sids) {
    let attempts = 0;
    while (attempts < 3) {
      try {
        const sub = await getSubscriber(sid);
        const n = getFieldValue(sub.custom_fields, "notes");
        if (n) {
          const notesStr = String(n);
          if (keywords.some((k) => notesStr.includes(k))) {
            hits.push({ sid, name: sub.name ?? null, notes: notesStr });
          }
        }
        break;
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("429") && attempts < 2) {
          attempts++;
          await new Promise((r) => setTimeout(r, 1500));
          continue;
        }
        console.log(`[${sid}] ERROR: ${msg.slice(0, 100)}`);
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  for (const h of hits) {
    console.log(`${h.sid} ${h.name}: ${h.notes.slice(0, 250)}`);
  }
  console.log(`\nTotal: ${hits.length}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
