import { db } from "@/lib/db";
import { leads } from "@/drizzle/schema";

const SHEET_ID = "1AnswoeBAFV-z4aN3KhqyJjb9DegyiDNH-0FcB8ry518";
const COL_NAME = 12, COL_PHONE = 13, COL_SENT = 18, COL_LAST_STATUS = 19, COL_SID = 20;

function parseCSVLine(line: string): string[] {
  const out: string[] = []; let cur = ""; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur); return out;
}
// Last 9 digits = the Israeli subscriber number (5XXXXXXXX), format-independent.
const last9 = (s: string) => s.replace(/[^0-9]/g, "").slice(-9);

async function main() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`;
  const resp = await fetch(url, { redirect: "follow" });
  if (!resp.ok) { console.error("sheet fetch failed:", resp.status); process.exit(1); }
  const lines = (await resp.text()).split(/\r?\n/);

  // DB phone index by last-9.
  const dbRows = await db.select({ phone: leads.phoneE164, waJid: leads.waJid, name: leads.name }).from(leads);
  const dbByLast9 = new Map<string, { name: string | null }>();
  for (const r of dbRows) {
    for (const cand of [r.phone, r.waJid]) {
      if (!cand) continue;
      const k = last9(cand);
      if (k.length === 9) dbByLast9.set(k, { name: r.name });
    }
  }
  console.log(`DB leads: ${dbRows.length} | sheet rows: ${lines.length - 1}\n`);

  const notInDb: any[] = [];
  let inDb = 0, skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim(); if (!line) continue;
    const r = parseCSVLine(line);
    const name = (r[COL_NAME] ?? "").trim();
    const rawPhone = (r[COL_PHONE] ?? "").trim();
    if (!name || !rawPhone) { skipped++; continue; }
    if (rawPhone.toLowerCase().includes("test lead")) { skipped++; continue; }
    const k = last9(rawPhone);
    if (k.length === 9 && dbByLast9.has(k)) { inDb++; continue; }
    notInDb.push({
      row: i + 1, name, phone: rawPhone,
      sent: (r[COL_SENT] ?? "").trim(),
      status: (r[COL_LAST_STATUS] ?? "").trim(),
      sid: (r[COL_SID] ?? "").trim(),
      last9: k,
    });
  }

  console.log(`✅ בתוך המערכת: ${inDb}`);
  console.log(`⏭️  דולגו (חסר שם/טלפון/טסט): ${skipped}`);
  console.log(`❌ לא נמצאו ב-DB: ${notInDb.length}\n`);
  for (const g of notInDb) {
    console.log(`  שורה ${g.row}: ${g.name} | ${g.phone} | SENT="${g.sent}" | status="${g.status || "—"}" | sid="${g.sid || "—"}"`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
