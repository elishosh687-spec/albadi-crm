/**
 * Ground truth: what totals did we actually SEND this customer on WhatsApp?
 *   DATABASE_URL=... npx tsx scripts/_diag-what-was-sent.ts "יוסי גולד בייבי"
 */
import { db } from "@/lib/db";
import { messages, leads } from "@/drizzle/schema";
import { and, desc, eq, sql } from "drizzle-orm";

async function main() {
  const name = process.argv[2] ?? "יוסי גולד בייבי";
  const [lead] = await db
    .select({ sid: leads.manychatSubId, name: leads.name })
    .from(leads)
    .where(eq(leads.name, name))
    .limit(1);
  if (!lead) { console.log("lead not found"); return; }

  // JID namespaces differ (@c.us vs @s.whatsapp.net) — match on phone digits.
  const digits = lead.sid.replace(/\D/g, "");
  const all = await db
    .select({ at: messages.receivedAt, sender: messages.sender, text: messages.text })
    .from(messages)
    .where(sql`regexp_replace(${messages.manychatSubId}, '\\D', '', 'g') LIKE ${"%" + digits + "%"}`);
  const rows = all
    .filter((r) => (r.text ?? "").includes("סה״כ"))
    .sort((a, b) => (a.at > b.at ? -1 : 1))
    .slice(0, 10);

  console.log(`${lead.name} — ${rows.length} הודעות עם "סה״כ" (מתוך ${all.length})\n`);
  for (const r of rows) {
    console.log(`--- ${r.at?.toISOString?.() ?? r.at} [${r.sender}]`);
    console.log((r.text ?? "").split("\n").filter((l) =>
      /סה״כ|יחידות|יח׳|תמחור|מקדמה|לתשלום|מע״מ|₪/.test(l)
    ).join("\n"));
    console.log("");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
