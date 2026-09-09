import { db } from "../lib/db";
import { leads, leadTags } from "../drizzle/schema";
import { eq, desc, gte, and, sql, or } from "drizzle-orm";

async function main() {
  const since = new Date(Date.now() - 60 * 60 * 1000); // last hour

  console.log("\n=== Recent ליד_חדש tag additions (last 1h) ===");
  const recentTags = await db
    .select({
      sid: leadTags.manychatSubId,
      setAt: leadTags.setAt,
      tag: leadTags.tag,
    })
    .from(leadTags)
    .where(and(eq(leadTags.tag, "ליד_חדש"), gte(leadTags.setAt, since)))
    .orderBy(desc(leadTags.setAt));

  console.log(`Found: ${recentTags.length}\n`);
  for (const t of recentTags) {
    const lead = await db
      .select({
        name: leads.name,
        phone: leads.phoneE164,
        leadSource: leads.leadSource,
        updatedAt: leads.updatedAt,
      })
      .from(leads)
      .where(sql`trim(${leads.manychatSubId}) = ${t.sid.trim()}`)
      .limit(1);
    const l = lead[0];
    console.log(
      `  ${new Date(t.setAt).toISOString().slice(0, 16).replace("T", " ")}  ${(l?.name ?? "—").padEnd(20)} ${(l?.phone ?? "—").padEnd(15)} leadSrc=${l?.leadSource ?? "—"}  sid=${t.sid}`,
    );
  }

  console.log("\n=== Eli's own number(s) in DB ===");
  // Common Eli numbers from past data
  const eliCandidates = ["972525755705", "972587490441"];
  for (const phone of eliCandidates) {
    const row = await db
      .select({
        sid: leads.manychatSubId,
        name: leads.name,
        phone: leads.phoneE164,
        leadSource: leads.leadSource,
        updatedAt: leads.updatedAt,
      })
      .from(leads)
      .where(eq(leads.phoneE164, phone))
      .limit(1);
    if (row[0]) {
      const tags = await db
        .select({ tag: leadTags.tag, setAt: leadTags.setAt })
        .from(leadTags)
        .where(sql`trim(${leadTags.manychatSubId}) = ${row[0].sid.trim()}`)
        .orderBy(desc(leadTags.setAt));
      console.log(
        `  ${row[0].phone}  ${row[0].name ?? "—"}  leadSrc=${row[0].leadSource ?? "—"}  updated=${new Date(row[0].updatedAt).toISOString().slice(0, 16).replace("T", " ")}`,
      );
      console.log(`     tags: ${tags.map((t) => `${t.tag}@${new Date(t.setAt).toISOString().slice(0, 16).replace("T", " ")}`).join(", ") || "(none)"}`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
